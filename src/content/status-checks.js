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
  const checkedReferrerUrls = new Set();
  const pendingAssetSources = new Set();
  const pendingReferrerUrls = new Set();
  let scheduledStatusCheck = null;

  function queueAssetStatusCheck(source) {
    if (checkedAssetSources.has(source) || pendingAssetSources.has(source)) {
      return;
    }

    pendingAssetSources.add(source);
    scheduleFlush();
  }

  function queueReferrerStatusCheck(referrerUrl) {
    if (checkedReferrerUrls.has(referrerUrl) || pendingReferrerUrls.has(referrerUrl)) {
      return;
    }

    pendingReferrerUrls.add(referrerUrl);
    scheduleFlush();
  }

  function markAssetSourceChecked(source) {
    checkedAssetSources.add(source);
  }

  function forgetAssetSource(source) {
    checkedAssetSources.delete(source);
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
    const referrerUrls = [...pendingReferrerUrls];

    pendingAssetSources.clear();
    pendingReferrerUrls.clear();

    if (assetUrls.length === 0 && referrerUrls.length === 0) {
      return;
    }

    assetUrls.forEach((assetUrl) => checkedAssetSources.add(assetUrl));
    referrerUrls.forEach((referrerUrl) => checkedReferrerUrls.add(referrerUrl));

    const [statusResult, openCountResult] = await Promise.allSettled([
      fetchAssetStatuses({ assetUrls, referrerUrls }),
      referrerUrls.length > 0 ? fetchOpenCounts({ referrerUrls }) : Promise.resolve({ counts: {} }),
    ]);

    if (openCountResult.status === 'fulfilled') {
      applyOpenCounts(referrerUrls, openCountResult.value.counts ?? {});
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

      if (state !== null) {
        applyAssetState(assetUrl, state);
      } else {
        clearAssetState(assetUrl);
      }
    }

    for (const referrerUrl of referrerUrls) {
      const state = payload.referrers?.[referrerUrl] ?? null;

      if (state !== null) {
        applyReferrerState(referrerUrl, state);
      } else {
        clearReferrerState(referrerUrl);
      }
    }
  }

  return {
    forgetAssetSource,
    markAssetSourceChecked,
    queueAssetStatusCheck,
    queueReferrerStatusCheck,
  };
}
