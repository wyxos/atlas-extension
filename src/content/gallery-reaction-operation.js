import { collectAssetBatchItems, validateAssetBatchContext } from './batch-providers/index.js';
import { postAssetReactionBatchViaBackground } from './background-api.js';

const requestSize = 50;
const cancelled = () => Object.assign(new Error('Gallery collection stopped.'), { code: 'BATCH_CANCELLED', retryable: true });

// One page owns one operation. Only the unacknowledged segment retains capture
// metadata; accepted segments keep compact results for badge updates/tab closing.
// A retry preserves the pending segment's membership and request identity, even
// when Desktop accepted it but the response was lost.
export function createGalleryReactionOperation(request, dependencies = {}) {
  const collect = dependencies.collect ?? collectAssetBatchItems;
  const validate = dependencies.validate ?? validateAssetBatchContext;
  const submit = dependencies.submit ?? postAssetReactionBatchViaBackground;
  const acknowledge = dependencies.acknowledge;
  const operationId = dependencies.operationId ?? globalThis.crypto.randomUUID();
  const accepted = new Set();
  const results = [];
  const previews = [];
  let buffer = [];
  let pending = null;
  let segment = 0;
  let acknowledgedIdempotencyKey = null;
  let controller;
  let running = null;
  let state = { phase: 'collecting', collected: 0, queued: 0, total: null, canRetry: false };

  function emit(onProgress, update) {
    state = { ...state, ...update, queued: accepted.size };
    onProgress?.({ ...state });
  }
  function assertCurrent() {
    if (controller.signal.aborted) throw cancelled();
  }
  async function execute({ onProgress, onAccepted } = {}) {
    controller = new globalThis.AbortController();
    const options = { documentContext: request.documentContext, locationContext: request.locationContext, signal: controller.signal };
    emit(onProgress, { phase: 'collecting', canRetry: false });
    async function flush() {
      assertCurrent();
      if (!pending && buffer.length === 0) return;
      pending ??= { items: buffer.splice(0), idempotencyKey: `${operationId}:${segment++}` };
      await validate(request.batchContext, options);
      emit(onProgress, { phase: 'queueing', collected: Math.max(state.collected, accepted.size + pending.items.length) });
      const payload = await submit({
        ...pending, downloadAction: request.downloadAction, reactionType: request.event.type,
        ...(acknowledgedIdempotencyKey ? { acknowledgedIdempotencyKey } : {}),
        ...(request.previewOnly === true ? { previewOnly: true } : {}),
        ...(request.useBrowserDownload === true ? { useBrowserDownload: true } : {}),
      });
      if (request.previewOnly !== true && (!Array.isArray(payload?.items) || payload.items.length !== pending.items.length
        || payload.items.some((item, index) => item?.asset_url !== pending.items[index].asset.source))) {
        throw Object.assign(new Error('Desktop returned an incomplete gallery acknowledgement.'), { code: 'INVALID_RESPONSE', retryable: true });
      }
      // A cancellation during a request does not discard its acknowledgement.
      // Keep its accepted items, then stop before collecting/submitting more.
      for (const item of pending.items) accepted.add(item.referrerUrl);
      if (request.previewOnly === true) previews.push(payload);
      const compact = (payload.items ?? []).map(compactResult);
      results.push(...compact);
      acknowledgedIdempotencyKey = pending.idempotencyKey;
      pending = null;
      // Bookkeeping cannot undo an accepted segment. The next submission carries
      // the same release marker if the background acknowledgement was lost.
      try { void Promise.resolve(acknowledge?.({ idempotencyKey: acknowledgedIdempotencyKey })).catch(() => {}); } catch { /* Retained until next segment or tab removal. */ }
      onAccepted?.({ items: compact });
      emit(onProgress, { phase: 'collecting' });
      assertCurrent();
    }
    try {
      await validate(request.batchContext, options);
      if (pending) await flush();
      // Captures not yet submitted are rediscovered after restoration. Accepted
      // gallery identities are skipped, so a retry never repeats older segments.
      buffer = [];
      await collect(request.batchContext, {
        ...options,
        onProgress(progress) {
          emit(onProgress, { ...progress, collected: Math.max(state.collected, progress.collected ?? 0) });
        },
        async onItem(item) {
          assertCurrent();
          if (!accepted.has(item.referrerUrl)) buffer.push(globalThis.structuredClone(item));
          if (buffer.length === requestSize) await flush();
        },
      });
      await flush();
      emit(onProgress, { phase: 'completed', collected: accepted.size, total: accepted.size, canRetry: false });
      return request.previewOnly === true ? { requests: [...previews] } : { items: [...results] };
    } catch (error) {
      const canRetry = !['BATCH_PROVIDER_CHANGED', 'BATCH_POST_CHANGED', 'BATCH_PROVIDER_UNAVAILABLE'].includes(error?.code);
      emit(onProgress, { phase: error?.code === 'BATCH_CANCELLED' ? 'cancelled' : 'paused', canRetry });
      throw error;
    }
  }
  return {
    run(callbacks) {
      if (running) return running;
      running = execute(callbacks).finally(() => { running = null; });
      return running;
    },
    cancel() { controller?.abort(); },
    async dismiss() {
      if (running) return;
      // Explicit Close abandons retry of an uncertain segment and releases its
      // per-tab preparation lease; any Desktop downloads already queued remain.
      const idempotencyKey = pending?.idempotencyKey ?? acknowledgedIdempotencyKey;
      if (idempotencyKey && acknowledge) await acknowledge({ idempotencyKey });
    },
    get running() { return running !== null; },
    get state() { return { ...state }; },
  };
}

function compactResult(item) {
  return {
    ...(typeof item.asset_url === 'string' ? { asset_url: item.asset_url } : {}),
    ...(item.file ? { file: { id: item.file.id, url: item.file.url } } : {}),
    ...(item.download ? { download: { ...item.download } } : {}),
    ...(Object.hasOwn(item, 'reaction') ? { reaction: item.reaction } : {}),
    ...(Object.hasOwn(item, 'blacklisted_at') ? { blacklisted_at: item.blacklisted_at } : {}),
  };
}
