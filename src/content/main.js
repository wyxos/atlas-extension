import { describeAssetElement } from './assets.js';
import {
  deleteAtlasFileViaBackground,
  fetchAssetStatusesViaBackground,
  fetchOpenReferrerCountsViaBackground,
  openReferrerInTabViaBackground,
  postAssetReactionViaBackground,
} from './background-api.js';
import { handleAssetShortcutEvent } from './asset-shortcuts.js';
import {
  shouldApplyAssetResponse,
  stateForSyncedAsset,
} from './asset-state.js';
import { createBadgePresentation } from './badge-model.js';
import { createAssetOverlay } from './overlay-controller.js';
import { createReferrerBadgeManager } from './referrer-badges.js';
import { createReferrerOpenGuard } from './referrer-open-guard.js';
import { createStatusCheckQueue } from './status-checks.js';
import { resolveVisibleRect } from './visible-rect.js';

const assetSelector = 'img, video, audio';
const overlayHostId = 'atlas-extension-asset-overlay';
const scanDelayMs = 50;
const statusCheckDelayMs = 100;
const referrerMinVisibleWidth = 40;
const viewportPadding = 4;

const assetIds = new Map();
const assetsById = new Map();
const badgeStatesById = new Map();
const elementsById = new Map();
let openReferrerCounts = {};

let scheduledScan = null;
let scheduledPositionUpdate = null;
let nextAssetId = 0;
let overlayController = null;

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
  clearAssetState: (assetUrl) => replaceBadgeStateBySource(assetUrl, {}),
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
  navigate: (url) => {
    window.location.assign(url);
  },
  openInNewTab: (url) => {
    void openReferrerInTabViaBackground({ url });
  },
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

  assetsById.set(id, asset);
  if (nextState === null) {
    badgeStatesById.delete(id);
  } else {
    badgeStatesById.set(id, nextState);
  }

  getOverlayController().upsertBadge(
    id,
    createBadgePresentation(asset, visibleRect, viewportPadding, nextState ?? {}),
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
    createBadgePresentation(asset, getVisibleRect(element), viewportPadding, nextState),
  );
}

function updateBadgeStateBySource(source, nextState) {
  for (const [id, asset] of assetsById.entries()) {
    if (asset.source === source) {
      updateBadgeState(id, nextState);
    }
  }
}

function replaceBadgeStateBySource(source, nextState) {
  for (const [id, asset] of assetsById.entries()) {
    if (asset.source === source) {
      replaceBadgeState(id, nextState);
    }
  }
}

function queueAssetStatusCheck(source) {
  statusChecks.queueAssetStatusCheck(source);
}

function queueReferrerStatusCheck(referrerUrl) {
  statusChecks.queueReferrerStatusCheck(referrerUrl);
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

  updateBadgeState(event.id, {
    isBusy: true,
    submittingReaction: event.type,
  });

  try {
    const payload = await postAssetReactionViaBackground({
      asset,
      reactionType: event.type,
      referrerUrl: window.location.href,
      source: window.location.hostname,
    });

    statusChecks.markAssetSourceChecked(asset.source);
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

function ensureBackgroundReverb() {
  try {
    globalThis.chrome?.runtime?.sendMessage?.({
      type: 'atlas-extension.ensure-reverb',
    });
  } catch {
    // Chrome can reject messages while an unpacked extension is reloading.
  }
}

function listenForDownloadEvents() {
  globalThis.chrome?.runtime?.onMessage?.addListener?.((message) => {
    if (message?.type !== 'atlas-extension.download-event') {
      return;
    }

    const assetUrl = typeof message.payload?.assetUrl === 'string'
      ? message.payload.assetUrl
      : null;

    if (assetUrl === null) {
      return;
    }

    updateBadgeStateBySource(assetUrl, {
      download: message.payload.download,
      file: message.payload.file,
      reaction: message.payload.reaction,
    });
    referrerBadges.updateByDownloadEvent(message.payload);
  });
}

function listenForOpenTabCounts() {
  globalThis.chrome?.runtime?.onMessage?.addListener?.((message) => {
    if (message?.type !== 'atlas-extension.open-tab-counts-changed') {
      return;
    }

    mergeOpenReferrerCounts(message.urls ?? [], message.counts ?? {});
  });
}

function listenForAssetShortcuts() {
  window.addEventListener('click', handleAssetShortcut, true);
  window.addEventListener('contextmenu', handleAssetShortcut, true);
  window.addEventListener('mousedown', handleAssetShortcut, true);
}

function listenForReferrerOpenAttempts() {
  window.addEventListener('click', referrerOpenGuard.handleBrowserEvent, true);
  window.addEventListener('auxclick', referrerOpenGuard.handleBrowserEvent, true);
  window.addEventListener('mousedown', (event) => {
    if (event.button === 1) {
      referrerOpenGuard.handleBrowserEvent(event);
    }
  }, true);
}

function listenForPageLocationChanges() {
  const refresh = () => {
    referrerBadges.updateOpenCounts(openReferrerCounts);
  };
  const originalPushState = window.history.pushState;
  const originalReplaceState = window.history.replaceState;

  window.history.pushState = function pushState(...args) {
    const result = originalPushState.apply(this, args);

    refresh();

    return result;
  };
  window.history.replaceState = function replaceState(...args) {
    const result = originalReplaceState.apply(this, args);

    refresh();

    return result;
  };
  window.addEventListener('popstate', refresh, { passive: true });
  window.addEventListener('hashchange', refresh, { passive: true });
}

scanAssets();
listenForDownloadEvents();
listenForOpenTabCounts();
listenForAssetShortcuts();
listenForReferrerOpenAttempts();
listenForPageLocationChanges();
ensureBackgroundReverb();

const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    if (mutation.type === 'attributes') {
      scanAssets(mutation.target?.parentElement ?? mutation.target);
      continue;
    }
    for (const node of mutation.addedNodes) {
      scanAssets(node);
    }
  }
});
observer.observe(document.documentElement, {
  attributeFilter: ['href', 'src', 'srcset', 'poster'],
  attributes: true,
  childList: true,
  subtree: true,
});
window.addEventListener('resize', schedulePositionUpdate, { passive: true });
window.addEventListener('scroll', schedulePositionUpdate, { capture: true, passive: true });
