import assert from 'node:assert/strict';
import test from 'node:test';

import { createDownloadEventState } from '../src/background/download-event-state.js';

test('keeps progress monotonic within one transfer generation', () => {
  const state = createDownloadEventState();

  assert.equal(state.accept(event({ progress: 42 })).download.progress_percent, 42);
  assert.equal(state.accept(event({ progress: 78 })).download.progress_percent, 78);
  assert.equal(state.accept(event({ progress: 20 })).download.progress_percent, 78);
});

test('preserves known progress when a status-only event arrives', () => {
  const state = createDownloadEventState();

  state.accept(event({ progress: 42 }));
  const next = state.accept(event({ progress: undefined, status: 'finalizing' }));

  assert.equal(next.download.progress_percent, 42);
  assert.equal(next.download.status, 'finalizing');
});

test('ignores stale attempts and generations', () => {
  const state = createDownloadEventState();

  state.accept(event({ attempt: 2, generation: 4, progress: 61 }));
  assert.equal(state.accept(event({ attempt: 1, generation: 4, progress: 90 })), null);
  assert.equal(state.accept(event({ attempt: 3, generation: 3, progress: 90 })), null);
});

test('allows a newer generation to restart progress', () => {
  const state = createDownloadEventState();

  state.accept(event({ generation: 4, progress: 100, status: 'completed' }));
  const next = state.accept(event({ generation: 5, progress: 0, status: 'pending' }));

  assert.equal(next.download.progress_percent, 0);
  assert.equal(next.download.status, 'pending');
});

test('allows a newer transfer row to restart a completed download at zero', () => {
  const state = createDownloadEventState();

  state.accept(event({ generation: 2, progress: 100, status: 'completed', transferId: 41 }));
  const next = state.accept(event({ generation: 0, progress: 0, status: 'pending', transferId: 42 }));

  assert.equal(next.download.progress_percent, 0);
  assert.equal(next.download.transfer_id, 42);
});

test('allows a valid transfer row to replace legacy progress without an identity', () => {
  const state = createDownloadEventState();

  state.accept(event({ progress: 100, status: 'completed', transferId: null }));
  const next = state.accept(event({ generation: 0, progress: 0, status: 'pending', transferId: 42 }));

  assert.equal(next.download.progress_percent, 0);
  assert.equal(next.download.transfer_id, 42);
});

function event({
  attempt = 1,
  generation = 4,
  progress,
  status = 'downloading',
  transferId = 41,
}) {
  return {
    assetUrl: 'https://example.test/asset.jpg',
    download: {
      attempt,
      generation,
      progress_percent: progress,
      status,
      transfer_id: transferId,
    },
  };
}
