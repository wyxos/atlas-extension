import assert from 'node:assert/strict';
import test from 'node:test';

import { fanoutTabMessage } from '../src/background/message-fanout.js';

for (const tabCount of [1, 100, 300, 700]) {
  test(`diagnostic baseline measures full broadcast fanout across ${tabCount} tabs`, async () => {
    const metrics = [];
    const sent = [];
    let clock = 0;
    const result = await fanoutTabMessage({
      clock: () => {
        clock += 1;
        return clock;
      },
      message: { type: 'atlas-extension.download-event' },
      onMetric: (metric) => metrics.push(metric),
      sendMessage: async (tabId) => { sent.push(tabId); },
      tabIds: Array.from({ length: tabCount }, (_, index) => index + 1),
    });

    assert.equal(sent.length, tabCount);
    assert.equal(result.deliveredTabIds.length, tabCount);
    assert.equal(metrics.filter((metric) => metric.name === 'message-latency').length, tabCount);
    assert.deepEqual(metrics.at(-1).details, {
      delivered: tabCount,
      failed: 0,
      targetedTabs: tabCount,
    });
  });
}

test('fanout measures failures without preventing delivery to other tabs', async () => {
  const metrics = [];
  const result = await fanoutTabMessage({
    message: { type: 'atlas-extension.download-event' },
    onMetric: (metric) => metrics.push(metric),
    sendMessage: async (tabId) => {
      if (tabId === 2) throw new Error('Frozen content script');
    },
    tabIds: [1, 2, 3],
  });

  assert.deepEqual(result.deliveredTabIds, [1, 3]);
  assert.deepEqual(result.failedTabIds, [2]);
  assert.equal(metrics.at(-1).details.failed, 1);
});
