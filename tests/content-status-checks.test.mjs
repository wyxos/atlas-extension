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
