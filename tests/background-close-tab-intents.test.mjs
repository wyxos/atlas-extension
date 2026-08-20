import assert from 'node:assert/strict';
import test from 'node:test';

import { closeTabModes } from '../src/shared/close-tab-preferences.js';
import { createCloseTabIntentManager } from '../src/background/close-tab-intents.js';

test('after queue close intents await the browser close result', async () => {
  const closedTabs = [];
  const manager = createCloseTabIntentManager({
    tabsApi: {
      remove(tabId, callback) {
        closedTabs.push(tabId);
        callback();
      },
    },
  });

  const result = await manager.armCloseIntent({
    assetUrls: ['https://cdn.example.test/video.mp4'],
    mode: closeTabModes.afterQueue,
    siteDomain: 'x.com',
    tabId: 42,
  });

  assert.deepEqual(result, {
    armed: true,
    closed: true,
    mode: closeTabModes.afterQueue,
    trackedAssetCount: 1,
  });
  assert.deepEqual(closedTabs, [42]);
});

test('on complete close intents wait for every queued asset', () => {
  const closedTabs = [];
  const manager = createCloseTabIntentManager({
    tabsApi: {
      remove(tabId, callback) {
        closedTabs.push(tabId);
        callback();
      },
    },
  });

  manager.armCloseIntent({
    assetUrls: [
      'https://cdn.example.test/file-1.jpg',
      'https://cdn.example.test/file-2.jpg',
    ],
    mode: closeTabModes.onComplete,
    siteDomain: 'deviantart.com',
    tabId: 7,
  });

  manager.handleDownloadEvent({
    assetUrl: 'https://cdn.example.test/file-1.jpg',
    download: { status: 'completed' },
  });
  assert.deepEqual(closedTabs, []);

  manager.handleDownloadEvent({
    assetUrl: 'https://cdn.example.test/file-2.jpg',
    download: { status: 'completed' },
  });
  assert.deepEqual(closedTabs, [7]);
});

test('failed or canceled tracked downloads keep the tab open and clear the intent', () => {
  const closedTabs = [];
  const manager = createCloseTabIntentManager({
    tabsApi: {
      remove(tabId, callback) {
        closedTabs.push(tabId);
        callback();
      },
    },
  });

  manager.armCloseIntent({
    assetUrls: ['https://cdn.example.test/file-1.jpg'],
    mode: closeTabModes.onComplete,
    siteDomain: 'youtube.com',
    tabId: 8,
  });
  manager.handleDownloadEvent({
    assetUrl: 'https://cdn.example.test/file-1.jpg',
    download: { status: 'failed' },
  });
  manager.handleDownloadEvent({
    assetUrl: 'https://cdn.example.test/file-1.jpg',
    download: { status: 'completed' },
  });

  assert.deepEqual(closedTabs, []);
});

test('retryable failure retains the close intent until the same transfer completes', () => {
  const closedTabs = [];
  const manager = createCloseTabIntentManager({
    tabsApi: {
      remove(tabId, callback) {
        closedTabs.push(tabId);
        callback();
      },
    },
  });

  manager.armCloseIntent({
    assetUrls: ['https://cdn.example.test/file-1.jpg'],
    mode: closeTabModes.onComplete,
    siteDomain: 'deviantart.com',
    tabId: 9,
  });
  manager.handleDownloadEvent({
    assetUrl: 'https://cdn.example.test/file-1.jpg',
    download: {
      attempt: 1,
      generation: 4,
      retry_disposition: 'retryable',
      status: 'failed',
      transfer_id: 'transfer-123',
    },
  });
  manager.handleDownloadEvent({
    assetUrl: 'https://cdn.example.test/file-1.jpg',
    download: {
      attempt: 2,
      generation: 4,
      retry_disposition: null,
      status: 'completed',
      transfer_id: 'transfer-123',
    },
  });
  manager.handleDownloadEvent({
    assetUrl: 'https://cdn.example.test/file-1.jpg',
    download: {
      attempt: 2,
      generation: 4,
      status: 'completed',
      transfer_id: 'transfer-123',
    },
  });

  assert.deepEqual(closedTabs, [9]);
});

test('stale attempts and unrelated transfer completions cannot close the tab', () => {
  const closedTabs = [];
  const manager = createCloseTabIntentManager({
    tabsApi: {
      remove(tabId, callback) {
        closedTabs.push(tabId);
        callback();
      },
    },
  });

  manager.armCloseIntent({
    assetUrls: ['https://cdn.example.test/file-1.jpg'],
    mode: closeTabModes.onComplete,
    siteDomain: 'deviantart.com',
    tabId: 10,
  });
  manager.handleDownloadEvent({
    assetUrl: 'https://cdn.example.test/file-1.jpg',
    download: { attempt: 2, generation: 1, status: 'downloading', transfer_id: 'transfer-a' },
  });
  manager.handleDownloadEvent({
    assetUrl: 'https://cdn.example.test/file-1.jpg',
    download: { attempt: 1, generation: 1, status: 'completed', transfer_id: 'transfer-a' },
  });
  manager.handleDownloadEvent({
    assetUrl: 'https://cdn.example.test/file-1.jpg',
    download: { attempt: 3, generation: 1, status: 'completed', transfer_id: 'transfer-b' },
  });

  assert.deepEqual(closedTabs, []);
});

test('non-download close intents close immediately after reaction completion', async () => {
  const closedTabs = [];
  const manager = createCloseTabIntentManager({
    tabsApi: {
      remove(tabId, callback) {
        closedTabs.push(tabId);
        callback();
      },
    },
  });

  const result = await manager.armCloseIntent({
    assetUrls: ['https://cdn.example.test/video.mp4'],
    mode: closeTabModes.onComplete,
    siteDomain: 'x.com',
    tabId: 42,
    waitForDownloads: false,
  });

  assert.deepEqual(result, {
    armed: true,
    closed: true,
    mode: closeTabModes.onComplete,
    trackedAssetCount: 1,
  });
  assert.deepEqual(closedTabs, [42]);
});

test('reports the exact browser close failure without claiming the tab closed', async () => {
  const previousChrome = globalThis.chrome;
  const metrics = [];
  globalThis.chrome = { runtime: {} };
  const manager = createCloseTabIntentManager({
    onMetric: (metric) => metrics.push(metric),
    tabsApi: {
      remove(_tabId, callback) {
        globalThis.chrome.runtime.lastError = { message: 'Tabs cannot be edited right now.' };
        callback();
        delete globalThis.chrome.runtime.lastError;
      },
    },
  });

  try {
    assert.deepEqual(await manager.armCloseIntent({
      assetUrls: ['https://cdn.example.test/video.mp4'],
      mode: closeTabModes.afterQueue,
      siteDomain: 'x.com',
      tabId: 42,
    }), {
      armed: true,
      closed: false,
      error: 'Tabs cannot be edited right now.',
      mode: closeTabModes.afterQueue,
      trackedAssetCount: 1,
    });
    assert.equal(metrics[0].details.error, 'Tabs cannot be edited right now.');
  } finally {
    globalThis.chrome = previousChrome;
  }
});

test('records close-intent latency only through the diagnostic hook', async () => {
  const metrics = [];
  let clock = 10;
  const manager = createCloseTabIntentManager({
    clock: () => {
      clock += 5;
      return clock;
    },
    onMetric: (metric) => metrics.push(metric),
    tabsApi: {
      remove(_tabId, callback) { callback(); },
    },
  });

  await manager.armCloseIntent({
    assetUrls: ['https://cdn.example.test/video.mp4'],
    mode: closeTabModes.afterQueue,
    siteDomain: 'x.com',
    tabId: 42,
  });

  assert.equal(metrics.length, 1);
  assert.equal(metrics[0].name, 'close-intent-latency');
  assert.equal(metrics[0].durationMs, 5);
});
