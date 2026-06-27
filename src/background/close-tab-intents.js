import { closeTabModes, normalizeCloseTabMode, normalizeSiteDomain } from '../shared/close-tab-preferences.js';

const failedStatuses = new Set(['canceled', 'failed']);

export function createCloseTabIntentManager({
  tabsApi = globalThis.chrome?.tabs,
} = {}) {
  const intentsByTabId = new Map();

  function armCloseIntent({ assetUrls, mode, siteDomain, tabId }) {
    const normalizedMode = normalizeCloseTabMode(mode);
    const normalizedTabId = normalizeTabId(tabId);
    const normalizedSiteDomain = normalizeSiteDomain(siteDomain);
    const trackedAssetUrls = normalizeAssetUrls(assetUrls);

    if (
      normalizedMode === closeTabModes.off
      || normalizedTabId === null
      || normalizedSiteDomain === null
      || trackedAssetUrls.length === 0
    ) {
      return {
        armed: false,
        closed: false,
        mode: normalizedMode,
        trackedAssetCount: trackedAssetUrls.length,
      };
    }

    if (normalizedMode === closeTabModes.afterQueue) {
      closeTab(normalizedTabId);

      return {
        armed: true,
        closed: true,
        mode: normalizedMode,
        trackedAssetCount: trackedAssetUrls.length,
      };
    }

    intentsByTabId.set(normalizedTabId, {
      pendingAssetUrls: new Set(trackedAssetUrls),
    });

    return {
      armed: true,
      closed: false,
      mode: normalizedMode,
      trackedAssetCount: trackedAssetUrls.length,
    };
  }

  function handleDownloadEvent(payload) {
    const assetUrl = typeof payload?.assetUrl === 'string' ? payload.assetUrl : null;
    const status = typeof payload?.download?.status === 'string' ? payload.download.status : null;

    if (assetUrl === null || status === null) {
      return;
    }

    for (const [tabId, intent] of intentsByTabId.entries()) {
      if (!intent.pendingAssetUrls.has(assetUrl)) {
        continue;
      }

      if (failedStatuses.has(status)) {
        intentsByTabId.delete(tabId);
        continue;
      }

      if (status !== 'completed') {
        continue;
      }

      intent.pendingAssetUrls.delete(assetUrl);

      if (intent.pendingAssetUrls.size === 0) {
        intentsByTabId.delete(tabId);
        closeTab(tabId);
      }
    }
  }

  function removeTab(tabId) {
    const normalizedTabId = normalizeTabId(tabId);

    if (normalizedTabId !== null) {
      intentsByTabId.delete(normalizedTabId);
    }
  }

  function closeTab(tabId) {
    try {
      tabsApi?.remove?.(tabId, () => {
        void globalThis.chrome?.runtime?.lastError;
      });
    } catch {
      // Chrome may reject tab operations while the tab is already closing.
    }
  }

  return {
    armCloseIntent,
    handleDownloadEvent,
    removeTab,
  };
}

function normalizeAssetUrls(assetUrls) {
  if (!Array.isArray(assetUrls)) {
    return [];
  }

  return [...new Set(assetUrls
    .map((assetUrl) => typeof assetUrl === 'string' ? assetUrl.trim() : '')
    .filter((assetUrl) => assetUrl !== ''))];
}

function normalizeTabId(tabId) {
  const number = Number(tabId);

  return Number.isInteger(number) && number >= 0 ? number : null;
}
