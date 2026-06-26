export const locationBridgeEventName = 'atlas-extension-location-change';

export function startContentRuntime({
  handleAssetShortcut,
  getOpenReferrerCounts,
  mergeOpenReferrerCounts,
  referrerBadges,
  referrerOpenGuard,
  scanAssets,
  schedulePositionUpdate,
  updateBadgeStateBySource,
}) {
  scanAssets();
  listenForDownloadEvents({ referrerBadges, updateBadgeStateBySource });
  listenForOpenTabCounts({ mergeOpenReferrerCounts });
  listenForAssetShortcuts({ handleAssetShortcut });
  listenForReferrerOpenAttempts({ referrerOpenGuard });
  listenForPageLocationChanges({
    getOpenReferrerCounts,
    referrerBadges,
    refreshAssets: scanAssets,
    schedulePositionUpdate,
  });
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

  return observer;
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

function listenForDownloadEvents({ referrerBadges, updateBadgeStateBySource }) {
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

function listenForOpenTabCounts({ mergeOpenReferrerCounts }) {
  globalThis.chrome?.runtime?.onMessage?.addListener?.((message) => {
    if (message?.type !== 'atlas-extension.open-tab-counts-changed') {
      return;
    }

    mergeOpenReferrerCounts(message.urls ?? [], message.counts ?? {});
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
