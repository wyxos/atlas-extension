import { describeAssetElement } from './assets.js';
import { bindBatchProviderPreferences, saveBatchProviderPreference } from './batch-provider-preferences.js';
import { createBatchProviderState } from './batch-provider-state.js';
import { deleteAtlasFileViaBackground, fetchAssetStatusesViaBackground, fetchOpenReferrerCountsViaBackground, openReferrerInTabViaBackground } from './background-api.js';
import { handleAssetShortcutEvent } from './asset-shortcuts.js';
import { shouldApplyAssetResponse, stateForSyncedAsset, stateWithoutAtlasAssetStatus } from './asset-state.js';
import { applyBatchReactionPayload, postAssetOrBatchReaction, stateWithBatchContext } from './batch-reactions.js';
import { resolveAssetBatchContext } from './batch-providers/index.js';
import { createBadgePresentation } from './badge-model.js';
import { armCloseTabForReaction } from './close-tab-reactions.js';
import { createCloseTabModeState } from './close-tab-mode-state.js';
import { createAssetOverlay } from './overlay-controller.js';
import { createReferrerBadgeManager } from './referrer-badges.js';
import { createReferrerOpenGuard } from './referrer-open-guard.js';
import { resolveDownloadActionForReaction } from './reaction-download-action.js';
import { createStatusCheckQueue } from './status-checks.js';
import { startContentRuntime } from './content-runtime.js';
import { resolveVisibleRect } from './visible-rect.js';

const assetSelector = 'img, video, audio';
const overlayHostId = 'atlas-extension-asset-overlay';
const scanDelayMs = 50;
const statusCheckDelayMs = 100;
const referrerMinVisibleWidth = 40;
const viewportPadding = 4;

const assetIds = new Map();
const assetsById = new Map();
const batchContextsById = new Map();
const badgeStatesById = new Map();
const elementsById = new Map();
let openReferrerCounts = {};
let scheduledScan = null;
let scheduledPositionUpdate = null;
let nextAssetId = 0;
let overlayController = null;
const closeTabMode = createCloseTabModeState({
  getLocationHref: () => window.location.href,
  onChanged: updateAllAssetBadgePresentations,
});
const batchProviderState = createBatchProviderState({
  getContextsById: () => batchContextsById,
  onBadgeState: updateBadgeState,
});

const referrerBadges = createReferrerBadgeManager({
  getCurrentPageUrl: () => window.location.href,
  getOverlayController,
  getVisibleRect: getReferrerVisibleRect,
  queueStatusCheck: queueReferrerStatusCheck,
  removeDirectBadge: removeBadge,
  removeOverlayBadge: (id) => overlayController?.removeBadge(id),
  viewportPadding,
});

const statusChecks = createStatusCheckQueue({
  applyAssetState: updateBadgeStateBySource,
  applyOpenCounts: mergeOpenReferrerCounts,
  applyReferrerState: referrerBadges.updateByReferrerUrl,
  clearAssetState: clearAtlasAssetStateBySource,
  clearReferrerState: (referrerUrl) => referrerBadges.replaceByReferrerUrl(referrerUrl, {}),
  delayMs: statusCheckDelayMs,
  fetchAssetStatuses: fetchAssetStatusesViaBackground,
  fetchOpenCounts: fetchOpenReferrerCountsViaBackground,
});

const referrerOpenGuard = createReferrerOpenGuard({
  confirmOpen: (request) => getOverlayController().confirmReferrerOpen(request),
  getAtlasState: (referrerUrl) => referrerBadges.getAtlasStateByReferrerUrl(referrerUrl),
  getCurrentPageUrl: () => window.location.href,
  getOpenCounts: () => openReferrerCounts,
  navigate: (url) => window.location.assign(url),
  openInNewTab: (url) => void openReferrerInTabViaBackground({ url }),
});

function getOverlayController() {
  if (overlayController !== null) {
    return overlayController;
  }

  const host = document.createElement('div');
  host.id = overlayHostId;
  host.setAttribute('style', [
    'all:initial',
    'contain:layout style paint',
    'inset:0',
    'pointer-events:none',
    'position:fixed',
    'z-index:2147483647',
  ].join(';'));

  const overlayRoot = host.attachShadow({ mode: 'open' });
  (document.body ?? document.documentElement).append(host);
  overlayController = createAssetOverlay(overlayRoot, {
    onBatchToggle: handleBadgeBatchToggle,
    onCloseModeChange: handleBadgeCloseModeChange,
    onDelete: handleBadgeDelete,
    onReact: handleBadgeReaction,
  });
  return overlayController;
}

function getAssetId(element) {
  const existingId = assetIds.get(element);

  if (existingId !== undefined) {
    return existingId;
  }

  const id = `asset-${nextAssetId}`;

  nextAssetId += 1;
  assetIds.set(element, id);
  elementsById.set(id, element);

  return id;
}

function removeBadge(element) {
  const id = assetIds.get(element);

  if (id === undefined) {
    return;
  }

  overlayController?.removeBadge(id);
  assetIds.delete(element);
  assetsById.delete(id);
  batchContextsById.delete(id);
  badgeStatesById.delete(id);
  elementsById.delete(id);
}

function syncAsset(element) {
  const asset = describeAssetElement(element);

  if (asset === null || !element?.isConnected) {
    removeBadge(element);

    return false;
  }

  referrerBadges.remove(element);

  const visibleRect = getVisibleRect(element);
  const id = getAssetId(element);
  const nextState = stateForSyncedAsset(assetsById.get(id), asset, badgeStatesById.get(id));
  const batchContext = resolveAssetBatchContext({
    asset,
    documentContext: document,
    element,
    locationContext: window.location,
  });
  const nextBadgeState = stateWithBatchContext(
    nextState,
    batchContext,
    batchProviderState.isProviderEnabled(batchContext?.provider),
  );

  assetsById.set(id, asset);
  if (batchContext === null) {
    batchContextsById.delete(id);
  } else {
    batchContextsById.set(id, batchContext);
  }
  if (nextBadgeState === null) {
    badgeStatesById.delete(id);
  } else {
    badgeStatesById.set(id, nextBadgeState);
  }

  getOverlayController().upsertBadge(
    id,
    createAssetBadgePresentation(asset, visibleRect, nextBadgeState ?? {}),
  );
  queueAssetStatusCheck(asset.source);

  return visibleRect !== null;
}

function updateBadgeState(id, nextState) {
  const currentState = badgeStatesById.get(id) ?? {};

  renderBadgeState(id, {
    ...currentState,
    ...nextState,
  });
}

function replaceBadgeState(id, nextState) {
  renderBadgeState(id, nextState);
}

function renderBadgeState(id, nextState) {
  const element = elementsById.get(id);
  const asset = assetsById.get(id);

  if (element === undefined || asset === undefined) {
    return;
  }

  badgeStatesById.set(id, nextState);
  getOverlayController().upsertBadge(
    id,
    createAssetBadgePresentation(asset, getVisibleRect(element), nextState),
  );
}

function createAssetBadgePresentation(asset, visibleRect, state) {
  return createBadgePresentation(asset, visibleRect, viewportPadding, {
    ...(state ?? {}),
    closeTab: closeTabMode.presentationState(),
  });
}

function updateBadgeStateBySource(source, nextState) {
  for (const [id, asset] of assetsById.entries()) {
    if (asset.source === source) {
      updateBadgeState(id, nextState);
    }
  }
}

function clearAtlasAssetStateBySource(source) {
  for (const [id, asset] of assetsById.entries()) {
    if (asset.source === source) {
      replaceBadgeState(id, stateWithoutAtlasAssetStatus(badgeStatesById.get(id)));
    }
  }
}

function queueAssetStatusCheck(source) {
  statusChecks.queueAssetStatusCheck(source);
}

function queueReferrerStatusCheck(referrerUrl, options) {
  statusChecks.queueReferrerStatusCheck(referrerUrl, options);
}

function mergeOpenReferrerCounts(referrerUrls, counts) {
  for (const referrerUrl of referrerUrls) {
    const count = Number(counts?.[referrerUrl] ?? 0);

    if (Number.isFinite(count) && count > 0) {
      openReferrerCounts[referrerUrl] = Math.floor(count);
    } else {
      delete openReferrerCounts[referrerUrl];
    }
  }

  referrerBadges.updateOpenCounts(openReferrerCounts);
}

async function handleBadgeReaction(event) {
  const asset = assetsById.get(event.id);
  const currentState = badgeStatesById.get(event.id) ?? {};

  if (asset === undefined || currentState.isBusy === true || currentState.isDeleting === true) {
    return;
  }

  const downloadAction = await resolveDownloadActionForReaction({
    asset,
    confirmReactionUpdate: (request) => getOverlayController().confirmReactionUpdate(request),
    currentState,
    event,
  });
  if (downloadAction === null) {
    return;
  }

  updateBadgeState(event.id, {
    isBusy: true,
    submittingReaction: event.type,
  });

  try {
    const payload = await postAssetOrBatchReaction({
      asset,
      batchContext: batchContextsById.get(event.id),
      currentState,
      documentContext: document,
      downloadAction,
      event,
      locationContext: window.location,
    });

    void armCloseTabForReaction(payload, {
      loadModeForSiteDomain: closeTabMode.loadModeForReaction,
      locationContext: window.location,
    });

    if (Array.isArray(payload.items)) {
      applyBatchReactionPayload(payload, {
        markAssetSourceChecked: (source) => statusChecks.markAssetSourceChecked(source),
        updateBadgeStateBySource,
      });
      if (shouldApplyAssetResponse(asset, assetsById.get(event.id))) {
        updateBadgeState(event.id, {
          isBusy: false,
          submittingReaction: null,
        });
      }

      return;
    }

    statusChecks.markAssetSourceChecked(asset.source, payload);
    if (!shouldApplyAssetResponse(asset, assetsById.get(event.id))) {
      return;
    }

    updateBadgeState(event.id, {
      ...payload,
      isBusy: false,
      submittingReaction: null,
    });
  } catch {
    if (!shouldApplyAssetResponse(asset, assetsById.get(event.id))) {
      return;
    }

    updateBadgeState(event.id, {
      download: {
        progress_percent: 0,
        status: 'failed',
      },
      isBusy: false,
      submittingReaction: null,
    });
  }
}

function handleBadgeBatchToggle(event) {
  const context = batchContextsById.get(event.id);

  if (context === undefined) {
    return;
  }

  batchProviderState.setProviderEnabled(context.provider, event.checked === true);
  batchProviderState.updateProvider(context.provider);
  void saveBatchProviderPreference(context.provider, event.checked === true);
}

function handleBadgeCloseModeChange(event) {
  void closeTabMode.setMode(event.mode);
}

function handleAssetShortcut(event) {
  handleAssetShortcutEvent(event, {
    getAssetIdForElement: (element) => assetIds.get(element) ?? null,
    onReact: ({ id, type }) => {
      void handleBadgeReaction({ id, type });
    },
  });
}

async function handleBadgeDelete(event) {
  const asset = assetsById.get(event.id);
  const currentState = badgeStatesById.get(event.id) ?? {};
  const fileId = resolveStateFileId(currentState);

  if (asset === undefined || fileId === null) {
    return;
  }

  updateBadgeState(event.id, { isDeleting: true });

  try {
    await deleteAtlasFileViaBackground({ fileId });
    statusChecks.forgetAssetSource(asset.source);
    if (!shouldApplyAssetResponse(asset, assetsById.get(event.id))) {
      return;
    }

    replaceBadgeState(event.id, {});
  } catch {
    if (!shouldApplyAssetResponse(asset, assetsById.get(event.id))) {
      return;
    }

    updateBadgeState(event.id, { isDeleting: false });
  }
}

function resolveStateFileId(state) {
  const id = Number(state.file?.id ?? state.download?.file_id ?? state.download?.fileId);

  return Number.isInteger(id) && id > 0 ? id : null;
}

function getVisibleRect(element) {
  return resolveVisibleRect(element, viewportPadding);
}

function getReferrerVisibleRect(element) {
  return resolveVisibleRect(element, viewportPadding, { minVisibleWidth: referrerMinVisibleWidth });
}

function watchAssetReadiness(element) {
  element.addEventListener('load', scheduleScan, { once: true });
  element.addEventListener('loadedmetadata', scheduleScan, { once: true });
}

function listAssets(root) {
  const assets = [];

  if (root?.matches?.(assetSelector)) {
    assets.push(root);
  }

  assets.push(...(root?.querySelectorAll?.(assetSelector) ?? []));

  return assets;
}

function scanAssets(root = document) {
  for (const element of listAssets(root)) {
    if (!syncAsset(element)) {
      referrerBadges.sync(element);
    }

    watchAssetReadiness(element);
  }
}

function positionKnownBadges() {
  for (const element of assetIds.keys()) {
    if (!element.isConnected || describeAssetElement(element) === null) {
      removeBadge(element);

      continue;
    }

    syncAsset(element);
  }
  referrerBadges.positionKnown();
}

function scheduleScan() {
  if (scheduledScan !== null) {
    return;
  }

  scheduledScan = window.setTimeout(() => {
    scheduledScan = null;
    scanAssets();
  }, scanDelayMs);
}

function schedulePositionUpdate() {
  if (scheduledPositionUpdate !== null) {
    return;
  }

  scheduledPositionUpdate = window.setTimeout(() => {
    scheduledPositionUpdate = null;
    positionKnownBadges();
  }, scanDelayMs);
}

function updateAllAssetBadgePresentations() {
  for (const [id, state] of badgeStatesById.entries()) {
    renderBadgeState(id, state);
  }
}

startContentRuntime({
  getOpenReferrerCounts: () => openReferrerCounts,
  handleAssetShortcut,
  mergeOpenReferrerCounts,
  referrerBadges,
  referrerOpenGuard,
  scanAssets,
  schedulePositionUpdate,
  updateBadgeStateBySource,
});
bindBatchProviderPreferences({ applyPreferences: batchProviderState.replacePreferences });
void closeTabMode.initialize();
