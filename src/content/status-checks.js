export function createStatusCheckQueue({
  applyAssetState,
  applyOpenCounts,
  applyReferrerState,
  clearAssetState,
  clearReferrerState,
  delayMs,
  fetchAssetStatuses,
  fetchOpenCounts,
  windowRef = window,
}) {
  const checkedAssetSources = new Set();
  const cachedAssetStates = new Map();
  const cachedReferrerStates = new Map();
  const checkedReferrerUrls = new Set();
  const pendingAssetSources = new Set();
  const pendingMatchItems = new Map();
  const pendingOpenReferrerUrls = new Set();
  const pendingReferrerUrls = new Set();
  let scheduledStatusCheck = null;

  function queueAssetStatusCheck(source, options = {}) {
    const queuedMatchItem = queueMatchItem(options.matchItem, {
      targetKey: source,
      targetType: 'asset',
    });

    if (checkedAssetSources.has(source)) {
      reapplyCachedAssetState(source);
      if (queuedMatchItem) {
        scheduleFlush();
      }

      return;
    }

    if (pendingAssetSources.has(source)) {
      return;
    }

    pendingAssetSources.add(source);
    scheduleFlush();
  }

  function queueReferrerStatusCheck(referrerUrl, options = {}) {
    let shouldSchedule = false;
    const shouldRefreshStatus = options.refreshStatus === true;

    if (queueMatchItem(options.matchItem, {
      targetKey: referrerUrl,
      targetType: 'referrer',
    })) {
      shouldSchedule = true;
    }

    if (options.refreshOpenCounts === true && !pendingOpenReferrerUrls.has(referrerUrl)) {
      pendingOpenReferrerUrls.add(referrerUrl);
      shouldSchedule = true;
    }

    if (shouldRefreshStatus) {
      pendingReferrerUrls.add(referrerUrl);
      shouldSchedule = true;
    } else if (checkedReferrerUrls.has(referrerUrl)) {
      reapplyCachedReferrerState(referrerUrl);
    } else if (!pendingReferrerUrls.has(referrerUrl)) {
      pendingReferrerUrls.add(referrerUrl);
      shouldSchedule = true;
    }

    if (shouldSchedule) {
      scheduleFlush();
    }
  }

  function markAssetSourceChecked(source, state = null) {
    checkedAssetSources.add(source);
    cachedAssetStates.set(source, state);
  }

  function markReferrerUrlChecked(referrerUrl, state = null) {
    checkedReferrerUrls.add(referrerUrl);
    cachedReferrerStates.set(referrerUrl, state);
  }

  function forgetAssetSource(source) {
    checkedAssetSources.delete(source);
    cachedAssetStates.delete(source);
  }

  function queueMatchItem(matchItem, target) {
    if (!matchItem || typeof matchItem !== 'object') {
      return false;
    }

    const lookupId = String(matchItem.lookup_id ?? '').trim();
    if (lookupId === '') {
      return false;
    }

    pendingMatchItems.set(lookupId, {
      ...matchItem,
      targetKey: target.targetKey,
      targetType: target.targetType,
    });

    return true;
  }

  function scheduleFlush() {
    if (scheduledStatusCheck !== null) {
      return;
    }

    scheduledStatusCheck = windowRef.setTimeout(() => {
      scheduledStatusCheck = null;
      void flush();
    }, delayMs);
  }

  async function flush() {
    const assetUrls = [...pendingAssetSources];
    const matchItems = [...pendingMatchItems.values()];
    const openReferrerUrls = [...pendingOpenReferrerUrls];
    const referrerUrls = [...pendingReferrerUrls];

    pendingAssetSources.clear();
    pendingMatchItems.clear();
    pendingOpenReferrerUrls.clear();
    pendingReferrerUrls.clear();

    if (assetUrls.length === 0 && referrerUrls.length === 0 && matchItems.length === 0 && openReferrerUrls.length === 0) {
      return;
    }

    const shouldFetchStatus = assetUrls.length > 0 || referrerUrls.length > 0 || matchItems.length > 0;
    const [statusResult, openCountResult] = await Promise.allSettled([
      shouldFetchStatus
        ? fetchAssetStatuses({ assetUrls, matchItems, referrerUrls })
        : Promise.resolve({ assets: {}, referrers: {} }),
      openReferrerUrls.length > 0 ? fetchOpenCounts({ referrerUrls: openReferrerUrls }) : Promise.resolve({ counts: {} }),
    ]);

    if (openCountResult.status === 'fulfilled') {
      applyOpenCounts(openReferrerUrls, openCountResult.value.counts ?? {});
    }

    if (statusResult.status !== 'fulfilled') {
      return;
    }

    applyStatusPayload({
      assetUrls,
      matchItems,
      payload: statusResult.value,
      referrerUrls,
    });
  }

  function applyStatusPayload({ assetUrls, matchItems, payload, referrerUrls }) {
    for (const assetUrl of assetUrls) {
      const state = payload.assets?.[assetUrl] ?? null;

      checkedAssetSources.add(assetUrl);
      cachedAssetStates.set(assetUrl, state);
      if (state !== null) {
        applyAssetState(assetUrl, state);
      } else {
        clearAssetState(assetUrl);
      }
    }

    for (const referrerUrl of referrerUrls) {
      const state = payload.referrers?.[referrerUrl] ?? null;

      checkedReferrerUrls.add(referrerUrl);
      cachedReferrerStates.set(referrerUrl, state);
      if (state !== null) {
        applyReferrerState(referrerUrl, state);
      } else {
        clearReferrerState(referrerUrl);
      }
    }

    for (const matchItem of matchItems) {
      const state = payload.matches?.[matchItem.lookup_id] ?? null;

      if (state === null) {
        continue;
      }

      if (matchItem.targetType === 'referrer') {
        checkedReferrerUrls.add(matchItem.targetKey);
        cachedReferrerStates.set(matchItem.targetKey, state);
        applyReferrerState(matchItem.targetKey, state);
      } else {
        checkedAssetSources.add(matchItem.targetKey);
        cachedAssetStates.set(matchItem.targetKey, state);
        applyAssetState(matchItem.targetKey, state);
      }
    }
  }

  function reapplyCachedAssetState(source) {
    const state = cachedAssetStates.get(source) ?? null;

    if (state !== null) {
      applyAssetState(source, state);
    } else {
      clearAssetState(source);
    }
  }

  function reapplyCachedReferrerState(referrerUrl) {
    const state = cachedReferrerStates.get(referrerUrl) ?? null;

    if (state !== null) {
      applyReferrerState(referrerUrl, state);
    } else {
      clearReferrerState(referrerUrl);
    }
  }

  return {
    forgetAssetSource,
    markAssetSourceChecked,
    markReferrerUrlChecked,
    queueAssetStatusCheck,
    queueReferrerStatusCheck,
  };
}
