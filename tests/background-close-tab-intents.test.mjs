import assert from 'node:assert/strict';
import test from 'node:test';

import { closeTabModes } from '../src/shared/close-tab-preferences.js';
import { createCloseTabIntentManager } from '../src/background/close-tab-intents.js';

const nextTask = () => new Promise((resolve) => globalThis.setTimeout(resolve, 0));

function snapshotManager(resolveAssetStatuses) {
  const closedTabs = [];
  const manager = createCloseTabIntentManager({ resolveAssetStatuses,
    tabsApi: { remove(tabId, callback) { closedTabs.push(tabId); callback(); } } });
  return { manager, closedTabs };
}

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

test('a whole gallery can close when earlier chunks completed before its intent was armed', async () => {
  const assetUrls = Array.from({ length: 200 }, (_, index) => `https://fixture.test/${index}.jpg`);
  const { manager, closedTabs } = snapshotManager(async (urls) => ({
    assets: Object.fromEntries(urls.map((url) => [url, { download: { status: 'completed' } }])),
  }));
  await manager.armCloseIntent({ assetUrls, mode: closeTabModes.onComplete, siteDomain: 'fixture.test', tabId: 11 });
  await nextTask();
  assert.deepEqual(closedTabs, [11]);
});

test('close reconciliation segments local status requests without a gallery count limit', async () => {
  const assetUrls = Array.from({ length: 901 }, (_, index) => `https://fixture.test/${index}.jpg`);
  const batches = [];
  const { manager, closedTabs } = snapshotManager(async (urls) => {
    batches.push(urls);
    return { assets: Object.fromEntries(urls.map((url) => [url, { download: { status: 'completed' } }])) };
  });
  await manager.armCloseIntent({ assetUrls, mode: closeTabModes.onComplete, siteDomain: 'fixture.test', tabId: 12 });
  await nextTask();
  assert.deepEqual(batches.map((batch) => batch.length), [300, 300, 300, 1]);
  assert.deepEqual(batches.flat(), assetUrls);
  assert.deepEqual(closedTabs, [12]);
});

test('an early terminal failure or cancellation keeps the gallery tab open', async () => {
  for (const status of ['failed', 'canceled']) {
    const assetUrl = 'https://fixture.test/failed.jpg';
    const { manager, closedTabs } = snapshotManager(async () => ({ assets: {
      [assetUrl]: { download: { status } },
    } }));
    await manager.armCloseIntent({ assetUrls: [assetUrl], mode: closeTabModes.onComplete, siteDomain: 'fixture.test', tabId: 13 });
    await nextTask();
    manager.handleDownloadEvent({ assetUrl, download: { status: 'completed' } });
    assert.deepEqual(closedTabs, []);
  }
});

test('retryable snapshot failures still wait for the tracked transfer to complete', async () => {
  const assetUrl = 'https://fixture.test/retry.jpg';
  const { manager, closedTabs } = snapshotManager(async () => ({ assets: {
    [assetUrl]: { download: { status: 'failed', retry_disposition: 'retryable', transfer_id: 41, generation: 1, attempt: 1 } },
  } }));
  await manager.armCloseIntent({ assetUrls: [assetUrl], mode: closeTabModes.onComplete, siteDomain: 'fixture.test', tabId: 14 });
  await nextTask();
  assert.deepEqual(closedTabs, []);
  manager.handleDownloadEvent({ assetUrl, download: { status: 'completed', transfer_id: 41, generation: 1, attempt: 2 } });
  assert.deepEqual(closedTabs, [14]);
});

test('events during reconciliation win over stale snapshot attempts', async () => {
  const assetUrl = 'https://fixture.test/race.jpg';
  let resolveSnapshot;
  const { manager, closedTabs } = snapshotManager(() => new Promise((resolve) => { resolveSnapshot = resolve; }));
  await manager.armCloseIntent({ assetUrls: [assetUrl], mode: closeTabModes.onComplete, siteDomain: 'fixture.test', tabId: 15 });
  manager.handleDownloadEvent({ assetUrl, download: { status: 'downloading', transfer_id: 42, generation: 2, attempt: 2 } });
  resolveSnapshot({ assets: { [assetUrl]: { download: { status: 'completed', transfer_id: 42, generation: 1, attempt: 1 } } } });
  await nextTask();
  assert.deepEqual(closedTabs, []);
  manager.handleDownloadEvent({ assetUrl, download: { status: 'completed', transfer_id: 42, generation: 2, attempt: 2 } });
  assert.deepEqual(closedTabs, [15]);
});

test('late reconciliation cannot close a removed or replaced tab intent', async () => {
  let resolveSnapshot;
  const { manager, closedTabs } = snapshotManager(() => new Promise((resolve) => { resolveSnapshot = resolve; }));
  const firstUrl = 'https://fixture.test/first.jpg';
  await manager.armCloseIntent({ assetUrls: [firstUrl], mode: closeTabModes.onComplete, siteDomain: 'fixture.test', tabId: 16 });
  manager.removeTab(16);
  resolveSnapshot({ assets: { [firstUrl]: { download: { status: 'completed' } } } });
  await nextTask();
  assert.deepEqual(closedTabs, []);
});

test('a failed status snapshot keeps the tab open and a later Desktop resync reconciles completion', async () => {
  const assetUrl = 'https://fixture.test/reconnect.jpg';
  let attempts = 0;
  const { manager, closedTabs } = snapshotManager(async () => {
    if (++attempts === 1) throw new Error('Fixture offline');
    return { assets: { [assetUrl]: { download: { status: 'completed' } } } };
  });
  await manager.armCloseIntent({ assetUrls: [assetUrl], mode: closeTabModes.onComplete, siteDomain: 'fixture.test', tabId: 17 });
  await nextTask();
  assert.deepEqual(closedTabs, []);
  manager.reconcile();
  await nextTask();
  assert.deepEqual(closedTabs, [17]);
  assert.equal(attempts, 2);
});
