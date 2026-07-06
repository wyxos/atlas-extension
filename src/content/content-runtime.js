import { initializeTabCounterBadge } from './tab-counter-badge.js';

export const locationBridgeEventName = 'atlas-extension-location-change';

export function startContentRuntime({
  handleAssetShortcut,
  getOpenReferrerCounts,
  handleDownloadEvent,
  mergeOpenReferrerCounts,
  referrerBadges,
  referrerOpenGuard,
  scanAssets,
  schedulePositionUpdate,
  updateBadgeStateBySource,
  waitForInitialDomMutationWindow: waitForDomMutationWindow = waitForInitialDomMutationWindow,
}) {
  let domMutationReady = false;
  const scanAssetsWhenReady = (root = document) => {
    if (!domMutationReady) {
      return;
    }

    scanAssets(root);
  };
  const observer = createAssetObserver({
    scanAssets: scanAssetsWhenReady,
    schedulePositionUpdate,
  });

  listenForDownloadEvents({ handleDownloadEvent, referrerBadges, updateBadgeStateBySource });
  listenForOpenTabCounts({ mergeOpenReferrerCounts });
  listenForManualScanRequests({ scanAssets: scanAssetsWhenReady, schedulePositionUpdate });
  listenForAssetShortcuts({ handleAssetShortcut });
  listenForReferrerOpenAttempts({ referrerOpenGuard });
  listenForPageLocationChanges({
    getOpenReferrerCounts,
    referrerBadges,
    refreshAssets: scanAssetsWhenReady,
    schedulePositionUpdate,
  });
  listenForPageActivationChanges({
    referrerBadges,
    refreshAssets: scanAssetsWhenReady,
    schedulePositionUpdate,
  });
  ensureBackgroundReverb();

  void waitForDomMutationWindow().then(() => {
    domMutationReady = true;

    void initializeTabCounterBadge();
    scanAssets();
    observer.observe(document.documentElement, initialObserverOptions);
    window.addEventListener('resize', schedulePositionUpdate, { passive: true });
    window.addEventListener('scroll', schedulePositionUpdate, { capture: true, passive: true });
  });

  return observer;
}

const initialObserverOptions = {
  attributeFilter: ['class', 'hidden', 'href', 'poster', 'src', 'srcset', 'style'],
  attributes: true,
  childList: true,
  subtree: true,
};

function createAssetObserver({ scanAssets, schedulePositionUpdate }) {
  return new MutationObserver((mutations) => {
    let shouldResyncKnownBadges = false;

    for (const mutation of mutations) {
      if (mutation.type === 'attributes') {
        scanAssets(mutation.target?.parentElement ?? mutation.target);
        continue;
      }
      for (const node of mutation.addedNodes) {
        scanAssets(node);
        shouldResyncKnownBadges = true;
      }
    }

    if (shouldResyncKnownBadges) {
      schedulePositionUpdate();
    }
  });
}

export async function waitForInitialDomMutationWindow({
  documentContext = document,
  timeoutMs = 2500,
  windowContext = window,
} = {}) {
  if (documentContext?.readyState && documentContext.readyState !== 'complete') {
    await Promise.race([
      waitForEvent(windowContext, 'load'),
      delay(windowContext, timeoutMs),
    ]);
  }

  await animationFrame(windowContext);
  await animationFrame(windowContext);
  await idle(windowContext, 250);
}

function waitForEvent(target, eventName) {
  return new Promise((resolve) => {
    if (typeof target?.addEventListener !== 'function') {
      resolve();

      return;
    }

    target.addEventListener(eventName, resolve, { once: true });
  });
}

function animationFrame(windowContext) {
  if (typeof windowContext?.requestAnimationFrame === 'function') {
    return new Promise((resolve) => windowContext.requestAnimationFrame(() => resolve()));
  }

  return delay(windowContext, 0);
}

function idle(windowContext, timeout) {
  if (typeof windowContext?.requestIdleCallback === 'function') {
    return new Promise((resolve) => windowContext.requestIdleCallback(resolve, { timeout }));
  }

  return delay(windowContext, timeout);
}

function delay(windowContext, ms) {
  const setTimeoutFunction = windowContext?.setTimeout ?? globalThis.setTimeout;

  return new Promise((resolve) => setTimeoutFunction(resolve, ms));
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

function listenForDownloadEvents({ handleDownloadEvent, referrerBadges, updateBadgeStateBySource }) {
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

    if (typeof handleDownloadEvent === 'function') {
      handleDownloadEvent(message.payload);

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

function listenForOpenTabCounts({ mergeOpenReferrerCounts }) {
  globalThis.chrome?.runtime?.onMessage?.addListener?.((message) => {
    if (message?.type !== 'atlas-extension.open-tab-counts-changed') {
      return;
    }

    mergeOpenReferrerCounts(message.urls ?? [], message.counts ?? {});
  });
}

function listenForManualScanRequests({ scanAssets, schedulePositionUpdate }) {
  globalThis.chrome?.runtime?.onMessage?.addListener?.((message, _sender, sendResponse) => {
    if (message?.type !== 'atlas-extension.manual-scan') {
      return;
    }

    scanAssets();
    schedulePositionUpdate();
    sendResponse?.({
      ok: true,
      payload: {
        scanned: true,
      },
    });

    return false;
  });
}

function listenForAssetShortcuts({ handleAssetShortcut }) {
  window.addEventListener('click', handleAssetShortcut, true);
  window.addEventListener('contextmenu', handleAssetShortcut, true);
  window.addEventListener('mousedown', handleAssetShortcut, true);
}

function listenForReferrerOpenAttempts({ referrerOpenGuard }) {
  window.addEventListener('click', referrerOpenGuard.handleBrowserEvent, true);
  window.addEventListener('auxclick', referrerOpenGuard.handleBrowserEvent, true);
  window.addEventListener('mousedown', (event) => {
    if (event.button === 1) {
      referrerOpenGuard.handleBrowserEvent(event);
    }
  }, true);
}

export function listenForPageLocationChanges({
  getOpenReferrerCounts,
  referrerBadges,
  refreshAssets = () => {},
  refreshDelayMs = 75,
  schedulePositionUpdate = () => {},
  windowContext = window,
}) {
  let pendingRefresh = null;
  const refresh = () => {
    pendingRefresh = null;
    referrerBadges.updateOpenCounts(getOpenReferrerCounts());
    refreshAssets();
    schedulePositionUpdate();
  };
  const scheduleRefresh = () => {
    if (pendingRefresh !== null) {
      return;
    }

    pendingRefresh = windowContext.setTimeout(refresh, refreshDelayMs);
  };
  const originalPushState = windowContext.history.pushState;
  const originalReplaceState = windowContext.history.replaceState;

  windowContext.history.pushState = function pushState(...args) {
    const result = originalPushState.apply(this, args);

    scheduleRefresh();

    return result;
  };
  windowContext.history.replaceState = function replaceState(...args) {
    const result = originalReplaceState.apply(this, args);

    scheduleRefresh();

    return result;
  };
  windowContext.addEventListener(locationBridgeEventName, scheduleRefresh, { passive: true });
  windowContext.addEventListener('popstate', scheduleRefresh, { passive: true });
  windowContext.addEventListener('hashchange', scheduleRefresh, { passive: true });
}

export function listenForPageActivationChanges({
  documentContext = globalThis.document,
  referrerBadges,
  refreshAssets = () => {},
  refreshDelayMs = 75,
  schedulePositionUpdate = () => {},
  windowContext = window,
}) {
  let pendingRefresh = null;
  const refresh = () => {
    pendingRefresh = null;
    refreshAssets();
    referrerBadges.refreshKnownReferrers?.({
      refreshOpenCounts: true,
      refreshStatus: true,
    });
    schedulePositionUpdate();
  };
  const scheduleRefresh = () => {
    if (pendingRefresh !== null) {
      return;
    }

    pendingRefresh = windowContext.setTimeout(refresh, refreshDelayMs);
  };
  const scheduleVisibleRefresh = () => {
    if (documentContext?.visibilityState === 'visible') {
      scheduleRefresh();
    }
  };

  windowContext.addEventListener('focus', scheduleRefresh, { passive: true });
  windowContext.addEventListener('pageshow', scheduleRefresh, { passive: true });
  documentContext?.addEventListener?.('visibilitychange', scheduleVisibleRefresh, { passive: true });
}
