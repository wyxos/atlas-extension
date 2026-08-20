import { closeTabModes, normalizeCloseTabMode, normalizeSiteDomain } from '../shared/close-tab-preferences.js';

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
      pendingAssets: new Map(trackedAssetUrls.map((assetUrl) => [assetUrl, {
        attempt: null,
        generation: null,
        transferId: null,
      }])),
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
      const tracked = intent.pendingAssets.get(assetUrl);
      if (!tracked || isStaleTransferEvent(tracked, payload.download)) {
        continue;
      }

      updateTrackedTransfer(tracked, payload.download);

      if (status === 'canceled' || isTerminalFailure(payload.download)) {
        intentsByTabId.delete(tabId);
        continue;
      }

      if (status === 'failed') {
        continue;
      }

      if (status !== 'completed') {
        continue;
      }

      intent.pendingAssets.delete(assetUrl);

      if (intent.pendingAssets.size === 0) {
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

function isTerminalFailure(download) {
  if (download?.status !== 'failed') {
    return false;
  }

  return download.retry_disposition !== 'retryable';
}

function isStaleTransferEvent(tracked, download) {
  const transferId = normalizeTransferId(download?.transfer_id);
  if (tracked.transferId !== null && transferId !== null && tracked.transferId !== transferId) {
    return true;
  }

  const generation = normalizeCounter(download?.generation);
  if (tracked.generation !== null && generation !== null && generation < tracked.generation) {
    return true;
  }

  const attempt = normalizeCounter(download?.attempt);
  return tracked.generation === generation
    && tracked.attempt !== null
    && attempt !== null
    && attempt < tracked.attempt;
}

function updateTrackedTransfer(tracked, download) {
  tracked.transferId ??= normalizeTransferId(download?.transfer_id);
  const generation = normalizeCounter(download?.generation);
  const attempt = normalizeCounter(download?.attempt);

  if (generation !== null && (tracked.generation === null || generation > tracked.generation)) {
    tracked.generation = generation;
    tracked.attempt = attempt;
    return;
  }

  tracked.generation = maxNullable(tracked.generation, generation);
  tracked.attempt = maxNullable(tracked.attempt, attempt);
}

function normalizeTransferId(value) {
  if (typeof value === 'string' && value.trim() !== '') {
    return value.trim();
  }

  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? String(number) : null;
}

function normalizeCounter(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function maxNullable(current, next) {
  if (current === null) return next;
  if (next === null) return current;
  return Math.max(current, next);
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
