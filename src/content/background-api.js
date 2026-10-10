import { createDesktopContractError, desktopMessageTypes } from '../shared/desktop-contract.js';
import { reactionFailureCodes, reactionMessageTypes, reactionRequestId } from '../shared/reaction-diagnostics.js';

const defaultTimeoutMs = 15000;
// Reactions include browser-session preparation before Desktop's 15s request
// deadline. The outer 30s deadline detects a lost worker reply without racing it.
const reactionTimeoutMs = 30000;

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
  acknowledgedIdempotencyKey,
  downloadAction,
  idempotencyKey,
  previewOnly,
  items,
  reactionType,
  useBrowserDownload,
  runtime = globalThis.chrome?.runtime,
  timeoutMs = defaultTimeoutMs,
}) {
  return sendBackgroundRequest({
    downloadAction,
    ...(acknowledgedIdempotencyKey === undefined ? {} : { acknowledgedIdempotencyKey }),
    ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    items,
    reactionType,
    ...(useBrowserDownload === true ? { useBrowserDownload: true } : {}),
    type: 'atlas-extension.asset-reaction-batch',
    ...(previewOnly === true ? { previewOnly: true } : {}),
  }, { runtime, timeoutMs });
}

export function acknowledgeGallerySegmentViaBackground({
  idempotencyKey,
  runtime = globalThis.chrome?.runtime,
  timeoutMs = defaultTimeoutMs,
}) {
  return sendBackgroundRequest({ type: 'atlas-extension.gallery-segment-acknowledged', idempotencyKey }, { runtime, timeoutMs });
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
  const isReaction = reactionMessageTypes.includes(message?.type);
  const requestId = isReaction ? reactionRequestId(message.requestId) : undefined;
  if (isReaction) message = { ...message, requestId };
  const timeoutMs = isReaction && options.timeoutMs === defaultTimeoutMs ? reactionTimeoutMs
    : typeof options.timeoutMs === 'number' ? options.timeoutMs : isReaction ? reactionTimeoutMs : defaultTimeoutMs;
  const workerError = (code, text) => createDesktopContractError(code, text, true, undefined, requestId);

  if (typeof runtime?.sendMessage !== 'function') {
    return Promise.reject(workerError('EXTENSION_WORKER_UNAVAILABLE', 'Atlas extension background worker is unavailable.'));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const timeoutId = globalThis.setTimeout(() => {
      finish(reject, workerError('EXTENSION_REQUEST_TIMEOUT', 'Atlas extension background request timed out.'));
    }, timeoutMs);

    function finish(callback, value) {
      if (settled) {
        return;
      }

      settled = true;
      globalThis.clearTimeout(timeoutId);
      if (callback === reject && isReaction) {
        if (!value?.requestId) value.requestId = requestId;
        // Best-effort event delivery only; a disconnected worker cannot be asked
        // to persist evidence. The page retains the reference in its error state.
        try { if (reactionFailureCodes.includes(value.code)) runtime.sendMessage({ type: 'atlas-extension.reaction-failure', failure: {
          requestId, code: value.code, phase: 'background-message',
          operation: message.type.endsWith('-batch') ? 'reaction-batch' : 'reaction',
        } }, () => { void runtime.lastError; }); } catch { /* Worker is unavailable. */ }
      }
      callback(value);
    }

    function handleResponse(response) {
      const lastError = runtime.lastError?.message;

      if (lastError) {
        finish(reject, workerError('EXTENSION_MESSAGE_FAILED', 'Atlas extension messaging failed.'));

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
        maybePromise.then(handleResponse).catch(() => finish(reject, workerError('EXTENSION_MESSAGE_FAILED', 'Atlas extension messaging failed.')));
      }
    } catch {
      finish(reject, workerError('EXTENSION_MESSAGE_FAILED', 'Atlas extension messaging failed.'));
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

export function openBrowserContainerViaBackground({ pageUrl, targetUrl, provider, profileVersion, actionId, observations,
  runtime = globalThis.chrome?.runtime }) {
  return sendBackgroundRequest({ type: desktopMessageTypes.openBrowserContainer,
    pageUrl, targetUrl, provider, profileVersion, actionId,
    ...(Array.isArray(observations) && observations.length ? { observations } : {}) }, { runtime, timeoutMs: defaultTimeoutMs });
}
