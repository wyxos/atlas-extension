const defaultTimeoutMs = 15000;

export function fetchAssetStatusesViaBackground({
  assetUrls,
  referrerUrls,
  runtime = globalThis.chrome?.runtime,
  timeoutMs = defaultTimeoutMs,
}) {
  return sendBackgroundRequest({
    assetUrls,
    referrerUrls,
    type: 'atlas-extension.asset-statuses',
  }, { runtime, timeoutMs });
}

export function fetchOpenReferrerCountsViaBackground({
  referrerUrls,
  runtime = globalThis.chrome?.runtime,
  timeoutMs = defaultTimeoutMs,
}) {
  return sendBackgroundRequest({
    referrerUrls,
    type: 'atlas-extension.open-referrer-counts',
  }, { runtime, timeoutMs });
}

export function openReferrerInTabViaBackground({
  runtime = globalThis.chrome?.runtime,
  timeoutMs = defaultTimeoutMs,
  url,
}) {
  return sendBackgroundRequest({
    type: 'atlas-extension.open-referrer-url',
    url,
  }, { runtime, timeoutMs });
}

export function postAssetReactionViaBackground({
  asset,
  downloadAction,
  reactionType,
  referrerUrl,
  runtime = globalThis.chrome?.runtime,
  source,
  timeoutMs = defaultTimeoutMs,
}) {
  return sendBackgroundRequest({
    asset,
    downloadAction,
    reactionType,
    referrerUrl,
    source,
    type: 'atlas-extension.asset-reaction',
  }, { runtime, timeoutMs });
}

export function postAssetReactionBatchViaBackground({
  downloadAction,
  items,
  reactionType,
  runtime = globalThis.chrome?.runtime,
  timeoutMs = defaultTimeoutMs,
}) {
  return sendBackgroundRequest({
    downloadAction,
    items,
    reactionType,
    type: 'atlas-extension.asset-reaction-batch',
  }, { runtime, timeoutMs });
}

export function deleteAtlasFileViaBackground({
  fileId,
  runtime = globalThis.chrome?.runtime,
  timeoutMs = defaultTimeoutMs,
}) {
  return sendBackgroundRequest({
    fileId,
    type: 'atlas-extension.file-delete',
  }, { runtime, timeoutMs });
}

export function sendBackgroundRequest(message, options = {}) {
  const runtime = options.runtime ?? globalThis.chrome?.runtime;
  const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : defaultTimeoutMs;

  if (typeof runtime?.sendMessage !== 'function') {
    return Promise.reject(new Error('Atlas extension background worker is unavailable.'));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const timeoutId = globalThis.setTimeout(() => {
      finish(reject, new Error('Atlas extension background request timed out.'));
    }, timeoutMs);

    function finish(callback, value) {
      if (settled) {
        return;
      }

      settled = true;
      globalThis.clearTimeout(timeoutId);
      callback(value);
    }

    function handleResponse(response) {
      const lastError = runtime.lastError?.message;

      if (lastError) {
        finish(reject, new Error(lastError));

        return;
      }

      if (response?.ok === false) {
        finish(reject, new Error(response.error ?? 'Atlas extension background request failed.'));

        return;
      }

      finish(resolve, response?.payload ?? {});
    }

    try {
      const maybePromise = runtime.sendMessage(message, handleResponse);

      if (maybePromise && typeof maybePromise.then === 'function') {
        maybePromise.then(handleResponse).catch((error) => finish(reject, error));
      }
    } catch (error) {
      finish(reject, error);
    }
  });
}
