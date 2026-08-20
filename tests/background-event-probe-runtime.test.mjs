import assert from 'node:assert/strict';
import test from 'node:test';

import { createEventProbeRunner } from '../src/background/event-probe-runtime.js';

test('reports Desktop, background, and active content acknowledgements', async () => {
  let probeId;
  const runner = createEventProbeRunner({
    queryActiveTab: async () => ({ id: 42 }),
    randomId: () => 'probe-1',
    requestContext: async () => ({
      credentials: { clientId: 'client' },
      transport: {
        async diagnosticProbe(_credentials, id) {
          probeId = id;
          return { probe_id: id, sequence: 7 };
        },
      },
    }),
    sendToTab: async (tabId, message) => {
      assert.equal(tabId, 42);
      assert.equal(message.probeId, 'probe-1');
      return { acknowledged: true, applied: true };
    },
  });

  const resultPromise = runner.testActiveTab();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(probeId, 'probe-1');
  assert.equal(runner.receive({ probeId, receivedAt: '2026-08-19T10:00:00Z', sequence: 7 }), true);

  assert.deepEqual(await resultPromise, {
    background: { received: true, receivedAt: '2026-08-19T10:00:00Z', sequence: 7 },
    content: { acknowledged: true, applied: true },
    desktop: { accepted: true, emitted: true },
    probeId: 'probe-1',
  });
});

test('times out when Desktop accepts but the WebSocket probe never arrives', async () => {
  let timeoutCallback;
  const runner = createEventProbeRunner({
    clearTimeoutFn: () => {},
    queryActiveTab: async () => ({ id: 42 }),
    randomId: () => 'probe-timeout',
    requestContext: async () => ({
      credentials: {},
      transport: { diagnosticProbe: async () => ({ probe_id: 'probe-timeout', sequence: 8 }) },
    }),
    sendToTab: async () => ({ acknowledged: true, applied: true }),
    setTimeoutFn(callback) {
      timeoutCallback = callback;
      return 1;
    },
    timeoutMs: 5000,
  });

  const resultPromise = runner.testActiveTab();
  await Promise.resolve();
  await Promise.resolve();
  timeoutCallback();
  await assert.rejects(resultPromise, /no probe event within 5 seconds/i);
  assert.equal(runner.receive({ probeId: 'probe-timeout' }), false);
});
