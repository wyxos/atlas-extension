import { closeTabModes, normalizeCloseTabMode, normalizeSiteDomain } from '../shared/close-tab-preferences.js';

const failedStatuses = new Set(['canceled', 'failed']);

export function createCloseTabIntentManager({
  clock = () => globalThis.performance?.now?.() ?? Date.now(),
  onMetric = () => {},
  tabsApi = globalThis.chrome?.tabs,
} = {}) {
  const intentsByTabId = new Map();

  async function armCloseIntent({ assetUrls, mode, siteDomain, tabId, waitForDownloads = true }) {
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

    if (normalizedMode === closeTabModes.afterQueue || waitForDownloads === false) {
      const closeResult = await closeTab(normalizedTabId, 'after-queue');

      return {
        armed: true,
        ...closeResult,
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
        void closeTab(tabId, 'downloads-completed');
      }
    }
  }

  function removeTab(tabId) {
    const normalizedTabId = normalizeTabId(tabId);

    if (normalizedTabId !== null) {
      intentsByTabId.delete(normalizedTabId);
    }
  }

  function closeTab(tabId, reason) {
    const startedAt = clock();

    return new Promise((resolve) => {
      let settled = false;
      const finish = (result) => {
        if (settled) {
          return;
        }
        settled = true;
        onMetric({
          details: {
            closed: result.closed === true,
            error: result.error ?? null,
            reason,
            tabId,
          },
          durationMs: Math.max(0, clock() - startedAt),
          name: 'close-intent-latency',
          recordedAt: Date.now(),
        });
        resolve(result);
      };

      if (typeof tabsApi?.remove !== 'function') {
        finish({
          closed: false,
          error: 'Chrome tabs API is unavailable.',
        });

        return;
      }

      try {
        const maybePromise = tabsApi.remove(tabId, () => {
          const error = globalThis.chrome?.runtime?.lastError?.message;

          finish(error
            ? { closed: false, error }
            : { closed: true });
        });

        if (maybePromise && typeof maybePromise.then === 'function') {
          maybePromise
            .then(() => finish({ closed: true }))
            .catch((error) => finish({
              closed: false,
              error: error?.message ?? 'Chrome could not close the tab.',
            }));
        }
      } catch (error) {
        finish({
          closed: false,
          error: error?.message ?? 'Chrome could not close the tab.',
        });
      }
    });
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
