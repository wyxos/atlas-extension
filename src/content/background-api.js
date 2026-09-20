const defaultTimeoutMs = 15000;

export function fetchAssetStatusesViaBackground({
  assetUrls,
  matchItems,
  referrerUrls,
  runtime = globalThis.chrome?.runtime,
  timeoutMs = defaultTimeoutMs,
}) {
  return sendBackgroundRequest(withoutUndefinedValues({
    assetUrls,
    matchItems,
    referrerUrls,
    type: 'atlas-extension.asset-statuses',
  }), { runtime, timeoutMs });
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

export function armDownloadCloseIntentViaBackground({
  assetUrls,
  mode,
  runtime = globalThis.chrome?.runtime,
  siteDomain,
  timeoutMs = defaultTimeoutMs,
  waitForDownloads,
}) {
  return sendBackgroundRequest(withoutUndefinedValues({
    assetUrls,
    mode,
    siteDomain,
    type: 'atlas-extension.download-close-intent',
    waitForDownloads,
  }), { runtime, timeoutMs });
}

export function postAssetReactionViaBackground({
  asset,
  previewOnly,
  downloadAction,
  reactionType,
  useBrowserDownload,
  referrerUrl,
  runtime = globalThis.chrome?.runtime,
  source,
  timeoutMs = defaultTimeoutMs,
}) {
  return sendBackgroundRequest({
    asset,
    downloadAction,
    reactionType,
    ...(useBrowserDownload === true ? { useBrowserDownload: true } : {}),
    referrerUrl,
    source,
    type: 'atlas-extension.asset-reaction',
    ...(previewOnly === true ? { previewOnly: true } : {}),
  }, { runtime, timeoutMs });
}

export function postAssetReactionBatchViaBackground({
  downloadAction,
  previewOnly,
  items,
  reactionType,
  useBrowserDownload,
  runtime = globalThis.chrome?.runtime,
  timeoutMs = defaultTimeoutMs,
}) {
  return sendBackgroundRequest({
    downloadAction,
    items,
    reactionType,
    ...(useBrowserDownload === true ? { useBrowserDownload: true } : {}),
    type: 'atlas-extension.asset-reaction-batch',
    ...(previewOnly === true ? { previewOnly: true } : {}),
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

export function openAtlasFileViaBackground({
  fileId,
  runtime = globalThis.chrome?.runtime,
  timeoutMs = defaultTimeoutMs,
}) {
  return sendBackgroundRequest({
    fileId,
    type: 'atlas-extension.desktop.open-file',
  }, { runtime, timeoutMs });
}

export function updateWidgetPlacementViaBackground({
  placement,
  runtime = globalThis.chrome?.runtime,
  siteDomain,
  timeoutMs = defaultTimeoutMs,
}) {
  return sendBackgroundRequest({
    placement,
    siteDomain,
    type: 'atlas-extension.desktop.update-widget-placement',
  }, { runtime, timeoutMs });
}

export function updateCloseTabModeViaBackground({
  mode,
  runtime = globalThis.chrome?.runtime,
  siteDomain,
  timeoutMs = defaultTimeoutMs,
}) {
  return sendBackgroundRequest({
    mode,
    siteDomain,
    type: 'atlas-extension.desktop.update-close-tab-mode',
  }, { runtime, timeoutMs });
}

export function updateBatchProviderPreferenceViaBackground({
  enabled,
  provider,
  runtime = globalThis.chrome?.runtime,
  timeoutMs = defaultTimeoutMs,
}) {
  return sendBackgroundRequest({
    enabled: enabled === true,
    provider,
    type: 'atlas-extension.desktop.update-batch-provider-preference',
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
        finish(reject, responseError(response.error));

        return;
      }

      if (response?.ok !== true || !response.payload || typeof response.payload !== 'object') {
        finish(reject, responseError({ code: 'INVALID_RESPONSE', message: 'Atlas extension returned an invalid response.', retryable: true }));
        return;
      }
      finish(resolve, response.payload);
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

function responseError(value) {
  const error = new Error(
    typeof value === 'object'
      ? value?.message ?? 'Atlas extension background request failed.'
      : value ?? 'Atlas extension background request failed.',
  );

  if (value && typeof value === 'object') {
    Object.assign(error, value);
  }

  return error;
}

function withoutUndefinedValues(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  );
}

export function resolveBrowserPagesViaBackground({ pages, runtime = globalThis.chrome?.runtime }) {
  return sendBackgroundRequest({ type: 'atlas-extension.browser-resolve', pages }, { runtime, timeoutMs: defaultTimeoutMs });
}
