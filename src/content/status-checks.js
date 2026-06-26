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
  const pendingOpenReferrerUrls = new Set();
  const pendingReferrerUrls = new Set();
  let scheduledStatusCheck = null;

  function queueAssetStatusCheck(source) {
    if (checkedAssetSources.has(source)) {
      reapplyCachedAssetState(source);

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

    if (options.refreshOpenCounts === true && !pendingOpenReferrerUrls.has(referrerUrl)) {
      pendingOpenReferrerUrls.add(referrerUrl);
      shouldSchedule = true;
    }

    if (checkedReferrerUrls.has(referrerUrl)) {
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

  function forgetAssetSource(source) {
    checkedAssetSources.delete(source);
    cachedAssetStates.delete(source);
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
    const openReferrerUrls = [...pendingOpenReferrerUrls];
    const referrerUrls = [...pendingReferrerUrls];

    pendingAssetSources.clear();
    pendingOpenReferrerUrls.clear();
    pendingReferrerUrls.clear();

    if (assetUrls.length === 0 && referrerUrls.length === 0 && openReferrerUrls.length === 0) {
      return;
    }

    const shouldFetchStatus = assetUrls.length > 0 || referrerUrls.length > 0;
    const [statusResult, openCountResult] = await Promise.allSettled([
      shouldFetchStatus
        ? fetchAssetStatuses({ assetUrls, referrerUrls })
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
      payload: statusResult.value,
      referrerUrls,
    });
  }

  function applyStatusPayload({ assetUrls, payload, referrerUrls }) {
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
    queueAssetStatusCheck,
    queueReferrerStatusCheck,
  };
}
