import assert from 'node:assert/strict';
import test from 'node:test';
import { createStatusCheckQueue } from '../src/content/status-checks.js';

const referrerUrl = 'https://example.test/restored';
const counts = { [referrerUrl]: 1 };
const settle = () => new Promise(resolve => setTimeout(resolve, 10));

function fixture() {
  const requests = [];
  const applied = [];
  const queue = createStatusCheckQueue({
    applyAssetState() {}, applyReferrerState() {}, clearAssetState() {}, clearReferrerState() {},
    applyOpenCounts: (_urls, value) => applied.push(value),
    fetchAssetStatuses: async () => ({ referrers: {} }),
    fetchOpenCounts: () => new Promise((resolve, reject) => requests.push({ resolve, reject })),
    delayMs: 0, windowRef: globalThis,
  });
  return { queue, requests, applied };
}

for (const inFlight of [false, true]) {
  test(`preferences reset recovers the ${inFlight ? 'in-flight' : 'queued'} initial lookup on an unchanged-link rescan`, async () => {
    const { queue, requests, applied } = fixture();
    queue.queueReferrerStatusCheck(referrerUrl, { refreshOpenCounts: true });
    if (inFlight) await settle();
    // Preferences/provider initialization invalidates the queue after the badge
    // manager has already registered this link. Its next sync passes false.
    queue.reset();
    queue.queueReferrerStatusCheck(referrerUrl, { refreshOpenCounts: false });
    await settle();
    assert.equal(requests.length, inFlight ? 2 : 1);
    requests.at(-1).resolve({ counts });
    await settle();
    if (inFlight) {
      requests[0].resolve({ counts: {} });
      await settle();
    }
    assert.deepEqual(applied.at(-1), counts);
    const previousRequests = requests.length;
    queue.queueReferrerStatusCheck(referrerUrl, { refreshOpenCounts: false });
    await settle();
    assert.equal(requests.length, previousRequests, 'unchanged scans must not poll tab counts');
  });
}

test('a failed initial lookup retries on the next scan and deduplicates while pending', async () => {
  const { queue, requests, applied } = fixture();
  queue.queueReferrerStatusCheck(referrerUrl, { refreshOpenCounts: true });
  await settle();
  queue.queueReferrerStatusCheck(referrerUrl, { refreshOpenCounts: false });
  await settle();
  assert.equal(requests.length, 1);
  requests[0].reject(new Error('Synthetic worker restart'));
  await settle();
  queue.queueReferrerStatusCheck(referrerUrl, { refreshOpenCounts: false });
  await settle();
  assert.equal(requests.length, 2);
  requests[1].resolve({ counts });
  await settle();
  assert.deepEqual(applied.at(-1), counts);
});
