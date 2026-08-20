import assert from 'node:assert/strict';
import test from 'node:test';

import { createPerformanceDiagnosticStore } from '../src/background/performance-diagnostics.js';
import { createPerformanceDiagnostics, performanceDiagnosticsStorageKey } from '../src/shared/performance-diagnostics.js';

test('diagnostics are inert unless explicitly enabled', async () => {
  const messages = [];
  const diagnostics = createPerformanceDiagnostics({
    clock: () => 20,
    runtime: { sendMessage: (message) => messages.push(message) },
    storageArea: { async get() { return {}; } },
  });
  await diagnostics.ready;

  diagnostics.finish('scan-duration', diagnostics.start(), { scannedElements: 700 });
  assert.deepEqual(messages, []);
});

test('enabled diagnostics capture bounded timing samples without changing the operation', async () => {
  const messages = [];
  let time = 10;
  const diagnostics = createPerformanceDiagnostics({
    clock: () => time,
    runtime: {
      sendMessage(message, callback) {
        messages.push(message);
        callback?.({ ok: true });
      },
    },
    storageArea: {
      async get(key) { return { [key]: key === performanceDiagnosticsStorageKey }; },
    },
  });
  await diagnostics.ready;
  const startedAt = diagnostics.start();
  time = 35;
  diagnostics.finish('reaction-latency', startedAt, { tabCount: 700 });

  assert.equal(messages[0].metric.durationMs, 25);
  assert.equal(messages[0].metric.name, 'reaction-latency');

  const store = createPerformanceDiagnosticStore({
    sampleLimit: 1,
    storageArea: {
      async get(key) { return { [key]: true }; },
      async set() {},
    },
  });
  await store.ready;
  store.record(messages[0].metric);
  store.record({ ...messages[0].metric, name: 'message-latency' });
  assert.deepEqual(store.snapshot().map((sample) => sample.name), ['message-latency']);
});
