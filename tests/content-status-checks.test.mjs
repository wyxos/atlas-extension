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

function waitForFlush() {
  return new Promise((resolve) => {
    setTimeout(resolve, 10);
  });
}
