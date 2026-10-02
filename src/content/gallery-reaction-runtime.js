import { acknowledgeGallerySegmentViaBackground } from './background-api.js';
import { createGalleryOperationLock } from './gallery-operation-lock.js';
import { createGalleryReactionOperation } from './gallery-reaction-operation.js';
import { reactionFailureFromError, safePostReactionError } from './reaction-failure-state.js';

// The page has one navigation owner, including request inspection. A paused
// operation retains its pending segment until Retry or explicit Close.
export function createGalleryReactionRuntime({ getOverlay, updateBadgeState, applyAccepted, closeAfterReaction }, dependencies = {}) {
  const lock = createGalleryOperationLock();
  const createOperation = dependencies.createOperation ?? createGalleryReactionOperation;
  let active = null;
  let preview = null;
  const busy = () => Object.assign(new Error('Retry or close the current gallery collection before starting another reaction.'), { code: 'BATCH_COLLECTION_BUSY' });

  async function run(collection) {
    const overlay = getOverlay();
    if (collection.notice) overlay.clearError(collection.notice);
    collection.notice = null;
    updateBadgeState(collection.id, { isBusy: true, submittingReaction: collection.reactionType });
    try {
      const payload = await collection.operation.run({
        onProgress: (state) => overlay.showCollectionProgress(state),
        onAccepted: applyAccepted,
      });
      try {
        const result = await closeAfterReaction(payload, collection.reactionType);
        if (result?.closeResult?.closed === false) overlay.showError('The gallery was queued, but Chrome could not close the tab.');
      } catch (error) { overlay.showError(safePostReactionError(error)); }
    } catch (error) {
      if (error?.code !== 'BATCH_CANCELLED') {
        collection.notice = `Gallery collection paused · ${reactionFailureFromError(error).message}`;
        overlay.showError(collection.notice);
      }
    } finally {
      updateBadgeState(collection.id, { isBusy: false, submittingReaction: null });
    }
  }
  async function dismiss() {
    const collection = active;
    if (!collection) return;
    try {
      await collection.operation.dismiss();
      if (active === collection) active = null;
      if (collection.notice) getOverlay().clearError(collection.notice);
    } catch {
      getOverlay().showCollectionProgress(collection.operation.state);
      getOverlay().showError('Could not close the collection. Retry or close it again.');
    }
  }
  return {
    async react(callback) {
      try {
        if (active && active.operation.state.phase !== 'completed') throw busy();
        await lock.runAction(async () => {
          if (active) { await active.operation.dismiss(); active = null; }
          return callback();
        });
      } catch (error) { getOverlay().showError(reactionFailureFromError(error).message); }
    },
    inspect(key, callback, id) {
      if (active && active.operation.state.phase !== 'completed') return Promise.reject(busy());
      return lock.runPreview(key, async () => {
        try { return await callback(operation => { preview = { operation, id }; }); }
        finally { preview = null; }
      });
    },
    start(request) {
      active = { id: request.id, reactionType: request.event.type,
        operation: createOperation(request, { acknowledge: acknowledgeGallerySegmentViaBackground }) };
      return run(active);
    },
    cancel() { active?.operation.cancel(); },
    cancelInspection({ id } = {}) { if (preview && preview.id === id) preview.operation.cancel(); },
    retry() {
      if (!active || lock.busy) return;
      void lock.runAction(() => run(active));
    },
    dismiss,
  };
}
