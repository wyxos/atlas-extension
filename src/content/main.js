import { describeAssetElement, getCurrentAssetSourcePreferences, initializeAssetSourcePreferences } from './assets.js';
import { createBatchProviderState } from './batch-provider-state.js';
import { deleteAtlasFileViaBackground, fetchAssetStatusesViaBackground, fetchOpenReferrerCountsViaBackground, openAtlasFileViaBackground, openReferrerInTabViaBackground, updateBatchProviderPreferenceViaBackground, updateCloseTabModeViaBackground, updateWidgetPlacementViaBackground } from './background-api.js';
import { decorateAssetWithMatchIdentity as decorateAssetWithMatchIdentityForRuntime, statusMatchItemForAsset } from './asset-match-runtime.js';
import { handleAssetShortcutEvent } from './asset-shortcuts.js';
import { findAssetShortcutFallback } from './asset-shortcut-target.js';
import { shouldApplyAssetResponse, stateForSyncedAsset, stateWithoutAtlasAssetStatus } from './asset-state.js';
import { applyBatchReactionPayload, postAssetOrBatchReaction, stateWithBatchContext } from './batch-reactions.js';
import { resolveAssetBatchContext } from './batch-providers/index.js';
import { createAssetBadgePresentation } from './asset-badge-presentation.js';
import { listAssetElements, watchAssetReadiness } from './asset-scanner.js';
import { createBadgeFileActions } from './badge-file-actions.js';
import { createBadgeHostManager } from './badge-hosts.js';
import { armCloseTabForReaction } from './close-tab-reactions.js';
import { createCloseTabModeState } from './close-tab-mode-state.js';
import { applyDownloadEvent } from './download-events.js';
import { createAssetOverlay } from './overlay-controller.js';
import { createOverlayRoot } from './overlay-host.js';
import { createReferrerBadgeManager } from './referrer-badges.js';
import { createReferrerOpenGuard } from './referrer-open-guard.js';
import { resolveDownloadActionForReaction } from './reaction-download-action.js';
import { applyAcceptedReactionPayload, reactionFailureFromError, safePostReactionError } from './reaction-failure-state.js';
import { resolveStateFileId } from './state-file-id.js';
import { createStatusCheckQueue } from './status-checks.js';
import { startContentRuntime } from './content-runtime.js';
import { createContentInterestReporter } from './content-interest-reporter.js';
import { resolveVisibleRect } from './visible-rect.js';
import { createWidgetPlacementRuntime } from './widget-placement-runtime.js';
import { createPerformanceDiagnostics } from '../shared/performance-diagnostics.js';
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
const performanceDiagnostics = createPerformanceDiagnostics();
let openReferrerCounts = {};
let scheduledScan = null;
let scheduledPositionUpdate = null;
let nextAssetId = 0;
let overlayController = null;
const badgeHosts = createBadgeHostManager();
const widgetPlacement = createWidgetPlacementRuntime({
  getElement: (id) => elementsById.get(id),
  getLocationHref: () => window.location.href,
  refresh: updateAllAssetBadgePresentations,
  reportFailure: (id, message) => updateBadgeState(id, {
    widgetPlacementError: `Widget position was not saved: ${message}`,
  }),
  savePlacement: updateWidgetPlacementViaBackground,
});
const closeTabMode = createCloseTabModeState({
  clearFailure: () => updateAllBadgeStates({ closeTabModeError: null }),
  getLocationHref: () => window.location.href,
  onChanged: updateAllAssetBadgePresentations,
  reportFailure: (message) => updateAllBadgeStates({ closeTabModeError: message }),
  saveMode: updateCloseTabModeViaBackground,
});
const batchProviderState = createBatchProviderState({
  getContextsById: () => batchContextsById,
  onBadgeState: updateBadgeState,
  savePreference: updateBatchProviderPreferenceViaBackground,
});
const referrerBadges = createReferrerBadgeManager({
  decorateAsset: decorateAssetWithMatchIdentity,
  getCurrentPageUrl: () => window.location.href,
  getOverlayController,
  getVisibleRect: getReferrerVisibleRect,
  placeBadge: (id, element, asset) => badgeHosts.placeBadge(id, element, asset, {
    variant: 'referrer',
    viewportPadding,
  }),
  queueStatusCheck: queueReferrerStatusCheck,
  removeDirectBadge: removeBadge,
  removeBadgeHost: (id) => badgeHosts.remove(id),
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
const contentInterests = createContentInterestReporter({
  diagnostics: performanceDiagnostics,
  getInterests: () => ({
    referrerUrls: [...referrerBadges.getKnownReferrerUrls(),
      ...[...assetsById.values()].map((asset) => asset.referrerUrl)],
    sourceUrls: [...assetsById.values()].map((asset) => asset.source),
  }),
  onResyncRequired: handleResyncRequired,
});
const badgeFileActions = createBadgeFileActions({
  assetsById, badgeStatesById, deleteFile: deleteAtlasFileViaBackground,
  forgetAssetSource: statusChecks.forgetAssetSource,
  openFile: openAtlasFileViaBackground, replaceBadgeState,
  resolveFileId: resolveStateFileId, shouldApplyResponse: shouldApplyAssetResponse,
  updateBadgeState,
});
function getOverlayController() {
  if (overlayController !== null) {
    return overlayController;
  }
  const overlayRoot = createOverlayRoot(document, overlayHostId);
  overlayController = createAssetOverlay(overlayRoot, {
    onBatchToggle: handleBadgeBatchToggle,
    onCloseModeChange: handleBadgeCloseModeChange,
    onDelete: badgeFileActions.handleDelete,
    onOpenFile: badgeFileActions.handleOpenFile,
    onPlacementChange: widgetPlacement.change,
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
  badgeHosts.remove(id);
  assetIds.delete(element);
  assetsById.delete(id);
  batchContextsById.delete(id);
  badgeStatesById.delete(id);
  elementsById.delete(id);
}
function syncAsset(element) {
  const rawAsset = describeAssetElement(element);
  const asset = rawAsset === null
    ? null
    : decorateAssetWithMatchIdentity(rawAsset, { referrerUrl: window.location.href });

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
    batchProviderState.presentationState(batchContext?.provider),
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

  if (visibleRect === null) {
    overlayController?.removeBadge(id);
    badgeHosts.remove(id);

    return true;
  }

  getOverlayController().upsertBadge(
    id,
    createAssetBadgePresentation({
      asset, badgeHosts, closeTab: closeTabMode.presentationState(), element, id,
      placement: widgetPlacement.placementForCurrentSite(),
      state: nextBadgeState, viewportPadding, visibleRect,
    }),
  );
  queueAssetStatusCheck(asset.source, {
    matchItem: statusMatchItemForAsset(asset, 'asset'),
  });
  return true;
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

  const visibleRect = getVisibleRect(element);

  badgeStatesById.set(id, nextState);
  if (visibleRect === null) {
    overlayController?.removeBadge(id);
    badgeHosts.remove(id);

    return;
  }

  getOverlayController().upsertBadge(
    id,
    createAssetBadgePresentation({
      asset, badgeHosts, closeTab: closeTabMode.presentationState(), element, id,
      placement: widgetPlacement.placementForCurrentSite(),
      state: nextState, viewportPadding, visibleRect,
    }),
  );
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
function queueAssetStatusCheck(source, options) { statusChecks.queueAssetStatusCheck(source, options); }

function queueReferrerStatusCheck(referrerUrl, options) { statusChecks.queueReferrerStatusCheck(referrerUrl, options); }

function decorateAssetWithMatchIdentity(asset, options = {}) {
  return decorateAssetWithMatchIdentityForRuntime({
    asset, pageUrl: window.location.href, preferences: getCurrentAssetSourcePreferences(), referrerUrl: options.referrerUrl ?? asset.referrerUrl, siteDomain: window.location.hostname,
  });
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

  const reactionStartedAt = performanceDiagnostics.start();
  const downloadAction = await resolveDownloadActionForReaction({
    asset,
    confirmReactionUpdate: (request) => getOverlayController().confirmReactionUpdate(request),
    currentState,
    event,
  });
  if (downloadAction === null) {
    performanceDiagnostics.finish('reaction-latency', reactionStartedAt, {
      canceled: true,
      reactionType: event.type,
    });
    return;
  }

  updateBadgeState(event.id, {
    isBusy: true,
    submittingReaction: event.type,
  });

  let payload;
  try {
    payload = await postAssetOrBatchReaction({
      asset,
      batchContext: batchContextsById.get(event.id),
      currentState,
      documentContext: document,
      downloadAction,
      event,
      locationContext: window.location,
    });

  } catch (error) {
    if (shouldApplyAssetResponse(asset, assetsById.get(event.id))) {
      updateBadgeState(event.id, {
        isBusy: false,
        reactionFailure: reactionFailureFromError(error),
        submittingReaction: null,
      });
    }
    performanceDiagnostics.finish('reaction-latency', reactionStartedAt, {
      reactionType: event.type,
    });
    return;
  }

  try {
    applyAcceptedReactionPayload(payload, {
      applyBatch: (batchPayload) => applyBatchReactionPayload(batchPayload, {
        markAssetSourceChecked: (source) => statusChecks.markAssetSourceChecked(source),
        updateBadgeStateBySource,
      }),
      applySingle: (singlePayload) => {
        statusChecks.markAssetSourceChecked(asset.source, singlePayload);
        if (shouldApplyAssetResponse(asset, assetsById.get(event.id))) {
          updateBadgeState(event.id, {
            ...singlePayload, isBusy: false, reactionFailure: null, submittingReaction: null,
          });
        }
      },
    });
    if (Array.isArray(payload.items)) {
      if (shouldApplyAssetResponse(asset, assetsById.get(event.id))) {
        updateBadgeState(event.id, { isBusy: false, submittingReaction: null });
      }
    }

    const closeIntent = await armCloseTabForReaction(payload, {
      loadModeForSiteDomain: closeTabMode.loadModeForReaction,
      locationContext: window.location, reactionType: event.type,
    });
    if (closeIntent?.closeResult?.closed === false) {
      updateBadgeState(event.id, {
        closeTabError: closeIntent.closeResult.error ?? 'Chrome could not close this tab.',
      });
    }
  } catch (error) {
    updateBadgeState(event.id, {
      closeTabError: safePostReactionError(error),
    });
  } finally {
    performanceDiagnostics.finish('reaction-latency', reactionStartedAt, {
      reactionType: event.type,
    });
  }
}
function handleBadgeBatchToggle(event) {
  const context = batchContextsById.get(event.id);
  if (context === undefined) return;
  void batchProviderState.changeProvider(context.provider, event.checked === true);
}

function handleBadgeCloseModeChange(event) { void closeTabMode.setMode(event.mode); }

function handleAssetShortcut(event) {
  handleAssetShortcutEvent(event, {
    getAssetIdForElement: (element) => assetIds.get(element) ?? null,
    getFallbackAssetId: (shortcutEvent) => findAssetShortcutFallback(shortcutEvent, { assetIds,
      isAssetVisible: (element) => getVisibleRect(element) !== null && describeAssetElement(element) !== null,
    }),
    onReact: ({ id, type }) => void handleBadgeReaction({ id, type }),
  });
}

function getVisibleRect(element) { return resolveVisibleRect(element, viewportPadding); }

function getReferrerVisibleRect(element) { return resolveVisibleRect(element, viewportPadding, { minVisibleWidth: referrerMinVisibleWidth }); }

function scanAssets(root = document) {
  const scanStartedAt = performanceDiagnostics.start();
  let scannedElements = 0;

  for (const element of listAssetElements(root, assetSelector)) {
    scannedElements += 1;
    if (!syncAsset(element)) {
      referrerBadges.sync(element);
    }

    watchAssetReadiness(element, scheduleScan);
  }

  contentInterests.schedule();
  performanceDiagnostics.finish('scan-duration', scanStartedAt, { scannedElements });
}

function handleResyncRequired() {
  statusChecks.reset();
  referrerBadges.refreshKnownReferrers?.({ refreshOpenCounts: true, refreshStatus: true });
  scanAssets();
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
  contentInterests.schedule();
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

function updateAllBadgeStates(patch) { for (const id of badgeStatesById.keys()) updateBadgeState(id, patch); }

startContentRuntime({
  getOpenReferrerCounts: () => openReferrerCounts,
  handleAssetShortcut,
  handleDownloadEvent: (payload) => applyDownloadEvent(payload, {
    markAssetSourceChecked: statusChecks.markAssetSourceChecked,
    markReferrerUrlChecked: statusChecks.markReferrerUrlChecked,
    updateBadgeStateBySource,
    updateReferrerBadges: referrerBadges.updateByDownloadEvent,
  }),
  handleResyncRequired,
  mergeOpenReferrerCounts,
  referrerBadges,
  referrerOpenGuard,
  scanAssets,
  schedulePositionUpdate,
  updateBadgeStateBySource,
});
void batchProviderState.initialize();
void closeTabMode.initialize();
void widgetPlacement.initialize();
globalThis.chrome?.storage?.onChanged?.addListener?.((changes, areaName) => widgetPlacement.applyStorageChange(changes, areaName));
void initializeAssetSourcePreferences({ onChanged: () => { scheduleScan(); schedulePositionUpdate(); } });
