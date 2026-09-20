import assert from 'node:assert/strict';
import test from 'node:test';
import { createContentInterestRegistry } from '../src/background/content-interest-registry.js';
import { deliverContentResync } from '../src/background/content-resync.js';

test('resuming a loading tab delivers its deferred hard invalidation rather than a soft refresh', async () => {
  const registry = createContentInterestRegistry({ storageArea: null });
  await registry.ready;
  registry.register({ tabId: 1, documentId: 'fixture' });
  registry.updateLifecycle(1, { status: 'loading' });
  const messages = [];
  const sendMessage = async (_tabId, message) => messages.push(message);
  assert.equal(await deliverContentResync({ registry, sendMessage, tabId: 1 }), false);
  assert.equal(messages.length, 0);
  registry.updateLifecycle(1, { status: 'complete' });
  assert.equal(await deliverContentResync({ registry, sendMessage, tabId: 1, providerChanged: false }), true);
  assert.deepEqual(messages, [{ type: 'atlas-extension.desktop.resync-required', providerChanged: true }]);
  assert.equal(registry.targetState(1).needsResync, false);
});

test('a failed delivery and an older acknowledgement cannot discard hard invalidation', async () => {
  const registry = createContentInterestRegistry({ storageArea: null });
  await registry.ready;
  registry.register({ tabId: 1, documentId: 'fixture' });
  await deliverContentResync({ registry, tabId: 1, sendMessage: async () => { throw new Error('not available'); } });
  assert.equal(registry.targetState(1).providerChanged, true);
  let complete;
  const pending = deliverContentResync({ registry, tabId: 1, providerChanged: false, sendMessage: () => new Promise(resolve => { complete = resolve; }) });
  registry.markNeedsResync(1, true);
  complete();
  await pending;
  assert.equal(registry.targetState(1).providerChanged, true);
});
