import { closeTabModes, normalizeCloseTabMode, normalizeSiteDomain } from '../shared/close-tab-preferences.js';

export function createCloseTabIntentManager({
  clock = () => globalThis.performance?.now?.() ?? Date.now(),
  onMetric = () => {},
  resolveAssetStatuses = null,
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

    const intent = {
      reconciling: typeof resolveAssetStatuses === 'function',
      pendingAssets: new Map(trackedAssetUrls.map((assetUrl) => [assetUrl, {
        attempt: null,
        generation: null,
        transferId: null,
      }])),
    };
    intentsByTabId.set(normalizedTabId, intent);
    if (intent.reconciling) {
      // Earlier chunks may finish before the gallery is fully queued. Listen
      // immediately, then reconcile only these assets in bounded local requests.
      void reconcileIntent(normalizedTabId, intent, trackedAssetUrls);
    }

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
      applyDownloadState(tabId, intent, assetUrl, payload.download);
    }
  }

  function applyDownloadState(tabId, intent, assetUrl, download) {
    const tracked = intent.pendingAssets.get(assetUrl);
    if (!tracked || isStaleTransferEvent(tracked, download)) return;
    updateTrackedTransfer(tracked, download);
    if (download.status === 'canceled' || isTerminalFailure(download)) {
      intentsByTabId.delete(tabId);
      return;
    }
    if (download.status === 'completed') intent.pendingAssets.delete(assetUrl);
    completeIntentIfReady(tabId, intent);
  }

  function completeIntentIfReady(tabId, intent) {
    if (intent.reconciling || intent.pendingAssets.size > 0 || intentsByTabId.get(tabId) !== intent) return;
    intentsByTabId.delete(tabId);
    void closeTab(tabId, 'downloads-completed');
  }

  async function reconcileIntent(tabId, intent, assetUrls) {
    try {
      for (let offset = 0; offset < assetUrls.length; offset += 300) {
        if (intentsByTabId.get(tabId) !== intent) return;
        const batch = assetUrls.slice(offset, offset + 300);
        const payload = await resolveAssetStatuses(batch);
        if (intentsByTabId.get(tabId) !== intent) return;
        for (const assetUrl of batch) {
          const download = payload?.assets?.[assetUrl]?.download;
          if (typeof download?.status === 'string') applyDownloadState(tabId, intent, assetUrl, download);
          if (intentsByTabId.get(tabId) !== intent) return;
        }
      }
    } catch {
      // Unknown status keeps the tab open; subsequent events can still finish
      // known transfers. Reconciliation never adds polling or claims completion.
    } finally {
      intent.reconciling = false;
      completeIntentIfReady(tabId, intent);
    }
  }

  function reconcile() {
    if (typeof resolveAssetStatuses !== 'function') return;
    for (const [tabId, intent] of intentsByTabId) {
      if (intent.reconciling) continue;
      intent.reconciling = true;
      void reconcileIntent(tabId, intent, [...intent.pendingAssets.keys()]);
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
    reconcile,
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
