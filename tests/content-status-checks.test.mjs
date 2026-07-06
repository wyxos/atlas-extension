import assert from 'node:assert/strict';
import test from 'node:test';

import { createStatusCheckQueue } from '../src/content/status-checks.js';

test('refreshes open-tab counts when a checked referrer is surfaced again', async () => {
  const statusRequests = [];
  const openCountRequests = [];
  const queue = createStatusCheckQueue({
    applyAssetState: () => {},
    applyOpenCounts: () => {},
    applyReferrerState: () => {},
    clearAssetState: () => {},
    clearReferrerState: () => {},
    delayMs: 0,
    fetchAssetStatuses: async (request) => {
      statusRequests.push(request);

      return { assets: {}, referrers: {} };
    },
    fetchOpenCounts: async (request) => {
      openCountRequests.push(request);

      return { counts: {} };
    },
    windowRef: globalThis,
  });

  queue.queueReferrerStatusCheck('https://www.example.test/post/123', { refreshOpenCounts: true });
  await waitForFlush();

  queue.queueReferrerStatusCheck('https://www.example.test/post/123', { refreshOpenCounts: true });
  await waitForFlush();

  assert.equal(statusRequests.length, 1);
  assert.equal(openCountRequests.length, 2);
  assert.deepEqual(openCountRequests.map((request) => request.referrerUrls), [
    ['https://www.example.test/post/123'],
    ['https://www.example.test/post/123'],
  ]);
});

test('reapplies cached asset status when a checked source is surfaced again', async () => {
  const assetUrl = 'https://cdn.example.test/file-1.jpg';
  const appliedStates = [];
  const statusRequests = [];
  const queue = createStatusCheckQueue({
    applyAssetState: (source, state) => {
      appliedStates.push({ source, state });
    },
    applyOpenCounts: () => {},
    applyReferrerState: () => {},
    clearAssetState: () => {},
    clearReferrerState: () => {},
    delayMs: 0,
    fetchAssetStatuses: async (request) => {
      statusRequests.push(request);

      return {
        assets: {
          [assetUrl]: {
            reaction: { type: 'love' },
          },
        },
        referrers: {},
      };
    },
    fetchOpenCounts: async () => ({ counts: {} }),
    windowRef: globalThis,
  });

  queue.queueAssetStatusCheck(assetUrl);
  await waitForFlush();
  appliedStates.length = 0;

  queue.queueAssetStatusCheck(assetUrl);
  await waitForFlush();

  assert.equal(statusRequests.length, 1);
  assert.deepEqual(appliedStates, [{
    source: assetUrl,
    state: {
      reaction: { type: 'love' },
    },
  }]);
});

test('applies derived match status to the matching asset source', async () => {
  const assetUrl = 'https://scontent.example.test/v/t39/photo.jpg?oh=volatile-token';
  const appliedStates = [];
  const statusRequests = [];
  const queue = createStatusCheckQueue({
    applyAssetState: (source, state) => {
      appliedStates.push({ source, state });
    },
    applyOpenCounts: () => {},
    applyReferrerState: () => {},
    clearAssetState: () => {},
    clearReferrerState: () => {},
    delayMs: 0,
    fetchAssetStatuses: async (request) => {
      statusRequests.push(request);

      return {
        assets: {},
        matches: {
          [`asset:${assetUrl}`]: {
            reaction: { type: 'love' },
          },
        },
        referrers: {},
      };
    },
    fetchOpenCounts: async () => ({ counts: {} }),
    windowRef: globalThis,
  });

  queue.queueAssetStatusCheck(assetUrl, {
    matchItem: {
      lookup_id: `asset:${assetUrl}`,
      match_by: 'referrer',
      match_url: 'https://www.facebook.com/photo/?fbid=122099716773370530',
      rule_digest: 'facebook-photo-v1',
      rule_id: 'facebook-photo',
    },
  });
  await waitForFlush();

  assert.deepEqual(statusRequests, [{
    assetUrls: [assetUrl],
    matchItems: [
      {
        lookup_id: `asset:${assetUrl}`,
        match_by: 'referrer',
        match_url: 'https://www.facebook.com/photo/?fbid=122099716773370530',
        rule_digest: 'facebook-photo-v1',
        rule_id: 'facebook-photo',
        targetKey: assetUrl,
        targetType: 'asset',
      },
    ],
    referrerUrls: [],
  }]);
  assert.deepEqual(appliedStates, [{
    source: assetUrl,
    state: {
      reaction: { type: 'love' },
    },
  }]);
});

test('fetches derived match status after source miss was cached', async () => {
  const assetUrl = 'https://scontent.example.test/v/t39/photo.jpg?oh=volatile-token';
  const matchItem = {
    lookup_id: `asset:${assetUrl}`,
    match_by: 'referrer',
    match_url: 'https://www.facebook.com/photo/?fbid=1577573303728044',
    rule_digest: 'facebook-photo-v1',
    rule_id: 'facebook-photo',
  };
  const appliedStates = [];
  const statusRequests = [];
  const queue = createStatusCheckQueue({
    applyAssetState: (source, state) => {
      appliedStates.push({ source, state });
    },
    applyOpenCounts: () => {},
    applyReferrerState: () => {},
    clearAssetState: () => {},
    clearReferrerState: () => {},
    delayMs: 0,
    fetchAssetStatuses: async (request) => {
      statusRequests.push(request);

      return request.matchItems.length > 0
        ? {
            assets: {},
            matches: {
              [matchItem.lookup_id]: {
                reaction: { type: 'love' },
              },
            },
            referrers: {},
          }
        : {
            assets: {},
            matches: {},
            referrers: {},
          };
    },
    fetchOpenCounts: async () => ({ counts: {} }),
    windowRef: globalThis,
  });

  queue.queueAssetStatusCheck(assetUrl);
  await waitForFlush();

  queue.queueAssetStatusCheck(assetUrl, { matchItem });
  await waitForFlush();

  assert.equal(statusRequests.length, 2);
  assert.deepEqual(statusRequests[1], {
    assetUrls: [],
    matchItems: [{
      ...matchItem,
      targetKey: assetUrl,
      targetType: 'asset',
    }],
    referrerUrls: [],
  });
  assert.deepEqual(appliedStates, [{
    source: assetUrl,
    state: {
      reaction: { type: 'love' },
    },
  }]);
});

test('splits large status checks into backend-sized batches', async () => {
  const statusRequests = [];
  const queue = createStatusCheckQueue({
    applyAssetState: () => {},
    applyOpenCounts: () => {},
    applyReferrerState: () => {},
    clearAssetState: () => {},
    clearReferrerState: () => {},
    delayMs: 0,
    fetchAssetStatuses: async (request) => {
      statusRequests.push(request);

      return { assets: {}, matches: {}, referrers: {} };
    },
    fetchOpenCounts: async () => ({ counts: {} }),
    windowRef: globalThis,
  });

  for (let index = 0; index < 301; index += 1) {
    queue.queueAssetStatusCheck(`https://cdn.example.test/media/${index}.jpg`, {
      matchItem: {
        lookup_id: `asset:${index}`,
        match_by: 'source',
        match_url: `https://cdn.example.test/media/${index}.jpg`,
      },
    });
  }
  await waitForFlush();

  assert.equal(statusRequests.length, 2);
  assert.deepEqual(statusRequests.map((request) => request.assetUrls.length), [300, 1]);
  assert.deepEqual(statusRequests.map((request) => request.matchItems.length), [300, 1]);
  assert.equal(statusRequests.every((request) => request.referrerUrls.length <= 300), true);
});

test('reapplies cached referrer status when a checked referrer is surfaced again', async () => {
  const referrerUrl = 'https://www.example.test/post/123';
  const appliedStates = [];
  const statusRequests = [];
  const queue = createStatusCheckQueue({
    applyAssetState: () => {},
    applyOpenCounts: () => {},
    applyReferrerState: (source, state) => {
      appliedStates.push({ source, state });
    },
    clearAssetState: () => {},
    clearReferrerState: () => {},
    delayMs: 0,
    fetchAssetStatuses: async (request) => {
      statusRequests.push(request);

      return {
        assets: {},
        referrers: {
          [referrerUrl]: {
            reaction: { type: 'like' },
          },
        },
      };
    },
    fetchOpenCounts: async () => ({ counts: {} }),
    windowRef: globalThis,
  });

  queue.queueReferrerStatusCheck(referrerUrl);
  await waitForFlush();
  appliedStates.length = 0;

  queue.queueReferrerStatusCheck(referrerUrl);
  await waitForFlush();

  assert.equal(statusRequests.length, 1);
  assert.deepEqual(appliedStates, [{
    source: referrerUrl,
    state: {
      reaction: { type: 'like' },
    },
  }]);
});

test('reapplies download event referrer status instead of stale open-tab state', async () => {
  const referrerUrl = 'https://www.example.test/post/123';
  const appliedStates = [];
  const clearedStates = [];
  const queue = createStatusCheckQueue({
    applyAssetState: () => {},
    applyOpenCounts: () => {},
    applyReferrerState: (source, state) => {
      appliedStates.push({ source, state });
    },
    clearAssetState: () => {},
    clearReferrerState: (source) => {
      clearedStates.push(source);
    },
    delayMs: 0,
    fetchAssetStatuses: async () => ({
      assets: {},
      referrers: {},
    }),
    fetchOpenCounts: async () => ({ counts: {} }),
    windowRef: globalThis,
  });

  queue.queueReferrerStatusCheck(referrerUrl);
  await waitForFlush();
  queue.markReferrerUrlChecked(referrerUrl, {
    download: {
      progress_percent: 42,
      status: 'downloading',
    },
    reaction: {
      type: 'love',
    },
  });
  appliedStates.length = 0;
  clearedStates.length = 0;

  queue.queueReferrerStatusCheck(referrerUrl);
  await waitForFlush();

  assert.deepEqual(clearedStates, []);
  assert.deepEqual(appliedStates, [{
    source: referrerUrl,
    state: {
      download: {
        progress_percent: 42,
        status: 'downloading',
      },
      reaction: {
        type: 'love',
      },
    },
  }]);
});

test('force refresh refetches a checked referrer status', async () => {
  const referrerUrl = 'https://www.example.test/post/123';
  const appliedStates = [];
  const statusRequests = [];
  let requestCount = 0;
  const queue = createStatusCheckQueue({
    applyAssetState: () => {},
    applyOpenCounts: () => {},
    applyReferrerState: (source, state) => {
      appliedStates.push({ source, state });
    },
    clearAssetState: () => {},
    clearReferrerState: () => {},
    delayMs: 0,
    fetchAssetStatuses: async (request) => {
      requestCount += 1;
      statusRequests.push(request);

      return requestCount === 1
        ? { assets: {}, referrers: {} }
        : {
            assets: {},
            referrers: {
              [referrerUrl]: {
                reaction: { type: 'love' },
              },
            },
          };
    },
    fetchOpenCounts: async () => ({ counts: {} }),
    windowRef: globalThis,
  });

  queue.queueReferrerStatusCheck(referrerUrl);
  await waitForFlush();

  queue.queueReferrerStatusCheck(referrerUrl, { refreshStatus: true });
  await waitForFlush();

  assert.equal(statusRequests.length, 2);
  assert.deepEqual(appliedStates, [{
    source: referrerUrl,
    state: {
      reaction: { type: 'love' },
    },
  }]);
});

test('retries asset status when the first status request fails', async () => {
  const assetUrl = 'https://cdn.example.test/retry.jpg';
  const appliedStates = [];
  let requestCount = 0;
  const queue = createStatusCheckQueue({
    applyAssetState: (source, state) => {
      appliedStates.push({ source, state });
    },
    applyOpenCounts: () => {},
    applyReferrerState: () => {},
    clearAssetState: () => {},
    clearReferrerState: () => {},
    delayMs: 0,
    fetchAssetStatuses: async () => {
      requestCount += 1;

      if (requestCount === 1) {
        throw new Error('temporary failure');
      }

      return {
        assets: {
          [assetUrl]: {
            reaction: { type: 'funny' },
          },
        },
        referrers: {},
      };
    },
    fetchOpenCounts: async () => ({ counts: {} }),
    windowRef: globalThis,
  });

  queue.queueAssetStatusCheck(assetUrl);
  await waitForFlush();
  queue.queueAssetStatusCheck(assetUrl);
  await waitForFlush();

  assert.equal(requestCount, 2);
  assert.deepEqual(appliedStates, [{
    source: assetUrl,
    state: {
      reaction: { type: 'funny' },
    },
  }]);
});

function waitForFlush() {
  return new Promise((resolve) => {
    setTimeout(resolve, 10);
  });
}
