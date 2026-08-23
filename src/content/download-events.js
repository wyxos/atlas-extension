const immediateDownloadStatuses = new Set([
  'canceled',
  'completed',
  'failed',
  'queued',
]);

export function applyDownloadEvent(payload, {
  markAssetSourceChecked,
  markReferrerUrlChecked,
  updateBadgeStateBySource,
  updateReferrerBadges,
}) {
  const assetUrl = typeof payload?.assetUrl === 'string' ? payload.assetUrl : null;

  if (assetUrl === null) {
    return;
  }

  const nextState = withoutUndefinedValues({
    download: payload.download,
    file: payload.file,
    reaction: payload.reaction,
  });
  const referrerUrl = typeof payload?.referrerUrl === 'string' ? payload.referrerUrl : null;

  markAssetSourceChecked(assetUrl, nextState);
  if (referrerUrl !== null) {
    markReferrerUrlChecked(referrerUrl, nextState);
  }

  updateBadgeStateBySource(assetUrl, nextState);
  updateReferrerBadges(payload);
}

export function createDownloadEventRenderQueue({
  applyEvent,
  windowContext = globalThis.window,
}) {
  const pendingByAssetUrl = new Map();

  return {
    push(payload) {
      const assetUrl = normalizeString(payload?.assetUrl);

      if (assetUrl === null) {
        return;
      }

      if (isImmediateDownloadEvent(payload)) {
        cancelPending(assetUrl, pendingByAssetUrl, windowContext);
        applyEvent(payload);

        return;
      }

      const pending = pendingByAssetUrl.get(assetUrl);

      if (pending !== undefined) {
        pending.payload = payload;

        return;
      }

      const next = { frameId: null, payload };
      next.frameId = requestFrame(windowContext, () => {
        if (pendingByAssetUrl.get(assetUrl) !== next) {
          return;
        }

        pendingByAssetUrl.delete(assetUrl);
        applyEvent(next.payload);
      });
      pendingByAssetUrl.set(assetUrl, next);
    },
  };
}

function withoutUndefinedValues(values) {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  );
}

function cancelPending(assetUrl, pendingByAssetUrl, windowContext) {
  const pending = pendingByAssetUrl.get(assetUrl);

  if (pending === undefined) {
    return;
  }

  pendingByAssetUrl.delete(assetUrl);
  cancelFrame(windowContext, pending.frameId);
}

function cancelFrame(windowContext, frameId) {
  if (typeof windowContext?.cancelAnimationFrame === 'function') {
    windowContext.cancelAnimationFrame(frameId);

    return;
  }

  const clearTimeoutFunction = windowContext?.clearTimeout ?? globalThis.clearTimeout;
  clearTimeoutFunction(frameId);
}

function isImmediateDownloadEvent(payload) {
  const status = normalizeString(payload?.download?.status)?.toLowerCase();

  return status !== undefined && immediateDownloadStatuses.has(status);
}

function normalizeString(value) {
  const normalized = typeof value === 'string' ? value.trim() : '';

  return normalized === '' ? null : normalized;
}

function requestFrame(windowContext, callback) {
  if (typeof windowContext?.requestAnimationFrame === 'function') {
    return windowContext.requestAnimationFrame(callback);
  }

  const setTimeoutFunction = windowContext?.setTimeout ?? globalThis.setTimeout;

  return setTimeoutFunction(callback, 0);
}
