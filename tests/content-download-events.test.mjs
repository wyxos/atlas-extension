import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyDownloadEvent,
  createDownloadEventRenderQueue,
} from '../src/content/download-events.js';

test('collapses in-flight progress to the latest event in one animation frame', () => {
  const applied = [];
  const frames = createFrameWindow();
  const queue = createDownloadEventRenderQueue({
    applyEvent: (payload) => applied.push(payload.download.progress_percent),
    windowContext: frames.windowContext,
  });

  queue.push(downloadEvent('asset-a', 'downloading', 10));
  queue.push(downloadEvent('asset-a', 'downloading', 20));
  queue.push(downloadEvent('asset-a', 'downloading', 35));

  assert.deepEqual(applied, []);
  frames.flush();
  assert.deepEqual(applied, [35]);
});

test('keeps animation-frame progress queues independent per asset', () => {
  const applied = [];
  const frames = createFrameWindow();
  const queue = createDownloadEventRenderQueue({
    applyEvent: (payload) => applied.push([
      payload.assetUrl,
      payload.download.progress_percent,
    ]),
    windowContext: frames.windowContext,
  });

  queue.push(downloadEvent('asset-a', 'downloading', 10));
  queue.push(downloadEvent('asset-b', 'preparing', 5));
  queue.push(downloadEvent('asset-a', 'downloading', 30));

  assert.equal(frames.pendingCount(), 2);
  frames.flush();
  assert.deepEqual(applied, [
    ['asset-a', 30],
    ['asset-b', 5],
  ]);
});

test('applies queue and terminal states immediately and cancels older pending progress', () => {
  const applied = [];
  const frames = createFrameWindow();
  const queue = createDownloadEventRenderQueue({
    applyEvent: (payload) => applied.push(payload.download.status),
    windowContext: frames.windowContext,
  });

  for (const status of ['queued', 'failed', 'canceled', 'completed']) {
    const assetUrl = `asset-${status}`;

    queue.push(downloadEvent(assetUrl, 'downloading', 74));
    queue.push(downloadEvent(assetUrl, status, status === 'completed' ? 100 : 74));
  }

  assert.deepEqual(applied, ['queued', 'failed', 'canceled', 'completed']);
  assert.equal(frames.pendingCount(), 0);
  frames.flush();
  assert.deepEqual(applied, ['queued', 'failed', 'canceled', 'completed']);
});

test('routes one DeviantArt event to the exact tokenized asset and referrer', () => {
  const assetUrl = 'https://images.example.test/file.jpg?token=abc123&quality=90';
  const payload = {
    assetUrl,
    download: {
      progress_percent: 42,
      status: 'downloading',
    },
    file: { id: 123 },
    reaction: { type: 'love' },
    referrerUrl: 'https://www.deviantart.com/artist/art/title-123?file=2',
  };
  const calls = [];

  applyDownloadEvent(payload, {
    markAssetSourceChecked: (url, state) => calls.push(['asset-cache', url, state]),
    markReferrerUrlChecked: (url, state) => calls.push(['referrer-cache', url, state]),
    updateBadgeStateBySource: (url, state) => calls.push(['asset-badge', url, state]),
    updateReferrerBadges: (eventPayload) => calls.push(['referrer-badge', eventPayload]),
  });

  assert.deepEqual(calls.map(([type, target]) => [type, target]), [
    ['asset-cache', assetUrl],
    ['referrer-cache', payload.referrerUrl],
    ['asset-badge', assetUrl],
    ['referrer-badge', payload],
  ]);
  assert.deepEqual(calls[0][2], {
    download: payload.download,
    file: payload.file,
    reaction: payload.reaction,
  });
  assert.strictEqual(calls[0][2], calls[1][2]);
  assert.strictEqual(calls[0][2], calls[2][2]);
});

function createFrameWindow() {
  const callbacks = new Map();
  let nextFrameId = 1;

  return {
    flush() {
      const pending = [...callbacks.values()];
      callbacks.clear();
      pending.forEach((callback) => callback());
    },
    pendingCount: () => callbacks.size,
    windowContext: {
      cancelAnimationFrame(frameId) {
        callbacks.delete(frameId);
      },
      requestAnimationFrame(callback) {
        const frameId = nextFrameId;
        nextFrameId += 1;
        callbacks.set(frameId, callback);

        return frameId;
      },
    },
  };
}

function downloadEvent(assetUrl, status, progress) {
  return {
    assetUrl,
    download: {
      progress_percent: progress,
      status,
    },
  };
}
