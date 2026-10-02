import { createAssetOverlay } from '../../src/content/overlay-controller.js';
import { createOverlayRoot } from '../../src/content/overlay-host.js';

const root = createOverlayRoot(document, 'atlas-synthetic-collection-progress');
const states = {
  collecting: { phase: 'collecting', collected: 84, total: 200, queued: 50 },
  unknown: { phase: 'collecting', collected: 84, total: null, queued: 50 },
  queueing: { phase: 'queueing', collected: 200, total: 200, queued: 150 },
  restoring: { phase: 'restoring', collected: 200, total: 200, queued: 200 },
  paused: { phase: 'paused', collected: 200, total: 200, queued: 50, canRetry: true },
  cancelled: { phase: 'cancelled', collected: 84, total: 200, queued: 50, canRetry: true },
  completed: { phase: 'completed', collected: 200, total: 200, queued: 200 },
};
let pendingInspection = null;
const controller = createAssetOverlay(root, {
  inspectReaction({ id }) {
    if (pendingInspection?.id === id) return pendingInspection.promise;
    let reject;
    const promise = new Promise((_resolve, rejectPromise) => { reject = rejectPromise; });
    pendingInspection = { id, promise, reject };
    document.querySelector('#action').textContent = 'Preparing synthetic payload';
    return promise;
  },
  cancelInspection({ id }) {
    if (pendingInspection?.id !== id) return;
    const inspection = pendingInspection;
    pendingInspection = null;
    document.querySelector('#action').textContent = 'Preparation cancel requested';
    inspection.reject(Object.assign(new Error('Synthetic preparation cancelled.'), { code: 'BATCH_CANCELLED' }));
  },
  onCollectionCancel() {
    document.querySelector('#action').textContent = 'Cancel requested';
    controller.showCollectionProgress(states.cancelled);
  },
  onCollectionRetry() {
    document.querySelector('#action').textContent = 'Retry requested';
    controller.showCollectionProgress(states.collecting);
  },
  onCollectionDismiss() {
    document.querySelector('#action').textContent = 'Collection progress closed';
  },
  onReact() {
    document.querySelector('#action').textContent = 'Collection started from Assets reaction';
    controller.showCollectionProgress(states.collecting);
  },
});
controller.upsertBadge('synthetic-asset', {
  source: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
  type: 'image', resolutionLabel: '1 × 1', progressPercent: 0,
  progressTone: 'idle', progressLabel: 'Ready',
  batch: { available: true, checked: true, supported: true },
  style: { display: 'none' },
});
document.querySelectorAll('[data-state]').forEach((button) => {
  button.addEventListener('click', () => controller.showCollectionProgress(states[button.dataset.state]));
});
document.querySelector('[data-reset]').addEventListener('click', () => {
  controller.showCollectionProgress(states.completed);
  controller.clearCollectionProgress();
  document.querySelector('#action').textContent = 'Ready';
});
document.querySelector('#action').textContent = 'Ready';
