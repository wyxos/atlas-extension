import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createBatchProviderState,
  safeBatchProviderSaveError,
} from '../src/content/batch-provider-state.js';
import { batchProviderPreferencesKey } from '../src/content/batch-provider-preferences.js';
import { desktopConnectionStorageKey } from '../src/shared/desktop-capabilities.js';

test('loads Desktop-synchronized provider state and updates every matching badge', async () => {
  const contexts = new Map([
    ['asset-1', { provider: 'deviantart' }],
    ['asset-2', { provider: 'deviantart' }],
    ['asset-3', { provider: 'youtube' }],
  ]);
  const updates = [];
  const state = createBatchProviderState({
    getContextsById: () => contexts,
    onBadgeState(id, nextState) {
      updates.push([id, nextState]);
    },
    onStorageChanged: { addListener() {} },
    storage: createStorage({
      [batchProviderPreferencesKey]: { deviantart: true },
      [desktopConnectionStorageKey]: { capabilities: ['batch-provider-preference'] },
    }),
  });

  await state.initialize();

  assert.equal(state.isProviderEnabled('deviantart'), true);
  assert.deepEqual(updates.filter(([id]) => id !== 'asset-3'), [
    ['asset-1', { batch: { available: true, checked: true, supported: true } }],
    ['asset-2', { batch: { available: true, checked: true, supported: true } }],
  ]);
});

test('optimistically updates one provider, blocks duplicate saves, and confirms Desktop state', async () => {
  const contexts = new Map([
    ['asset-1', { provider: 'deviantart' }],
    ['asset-2', { provider: 'deviantart' }],
    ['asset-3', { provider: 'youtube' }],
  ]);
  const saveGate = deferred();
  const saves = [];
  const state = createBatchProviderState({
    getContextsById: () => contexts,
    onBadgeState() {},
    onStorageChanged: { addListener() {} },
    savePreference(request) {
      saves.push(request);
      return saveGate.promise;
    },
    storage: createStorage({
      [desktopConnectionStorageKey]: { capabilities: ['batch-provider-preference'] },
    }),
  });
  await state.initialize();

  const saving = state.changeProvider('deviantart', true);
  void state.changeProvider('deviantart', false);

  assert.deepEqual(state.presentationState('deviantart'), {
    available: true,
    checked: true,
    saving: true,
    supported: true,
  });
  assert.deepEqual(state.presentationState('youtube'), {
    available: true,
    checked: false,
    supported: true,
  });
  assert.deepEqual(saves, [{ enabled: true, provider: 'deviantart' }]);

  saveGate.resolve({ enabled: true, provider: 'deviantart' });
  await saving;
  assert.deepEqual(state.presentationState('deviantart'), {
    available: true,
    checked: true,
    supported: true,
  });
});

test('reverts provider-wide optimistic state, reports failure, and clears it on retry', async () => {
  const contexts = new Map([
    ['asset-1', { provider: 'deviantart' }],
    ['asset-2', { provider: 'deviantart' }],
  ]);
  const updates = [];
  let shouldFail = true;
  const state = createBatchProviderState({
    getContextsById: () => contexts,
    onBadgeState(id, nextState) {
      updates.push([id, nextState]);
    },
    onStorageChanged: { addListener() {} },
    async savePreference({ enabled, provider }) {
      if (shouldFail) {
        const error = new Error('private detail');
        error.code = 'DESKTOP_OFFLINE';
        throw error;
      }
      return { enabled, provider };
    },
    storage: createStorage({
      [desktopConnectionStorageKey]: { capabilities: ['batch-provider-preference'] },
    }),
  });
  await state.initialize();
  updates.length = 0;

  await state.changeProvider('deviantart', true);

  assert.equal(state.isProviderEnabled('deviantart'), false);
  assert.equal(updates.at(-1)[1].batch.error, 'Atlas Desktop is offline. Batch mode was not saved.');
  assert.equal(updates.at(-2)[1].batch.error, 'Atlas Desktop is offline. Batch mode was not saved.');

  shouldFail = false;
  const retry = state.changeProvider('deviantart', true);
  assert.equal(state.presentationState('deviantart').error, undefined);
  await retry;
  assert.equal(state.isProviderEnabled('deviantart'), true);
  assert.equal(state.presentationState('deviantart').error, undefined);
  assert.equal(
    safeBatchProviderSaveError(new Error('private detail')),
    'Atlas Desktop could not save batch mode.',
  );
});

test('disables batch mode until Desktop advertises the capability', async () => {
  const listeners = [];
  let saveCalls = 0;
  const state = createBatchProviderState({
    getContextsById: () => new Map([['asset-1', { provider: 'deviantart' }]]),
    onBadgeState() {},
    onStorageChanged: {
      addListener(listener) { listeners.push(listener); },
    },
    async savePreference() { saveCalls += 1; },
    storage: createStorage(),
  });

  await state.initialize();
  assert.deepEqual(state.presentationState('deviantart'), {
    available: true,
    checked: false,
    supported: false,
    unsupportedMessage: 'Update Atlas Desktop to change batch mode.',
  });
  await state.changeProvider('deviantart', true);
  assert.equal(saveCalls, 0);

  listeners[0]({
    [desktopConnectionStorageKey]: {
      newValue: { capabilities: ['batch-provider-preference'] },
    },
  }, 'local');
  assert.equal(state.presentationState('deviantart').supported, true);
});

function createStorage(initial = {}) {
  const values = globalThis.structuredClone(initial);

  return {
    async get(key) { return { [key]: globalThis.structuredClone(values[key]) }; },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((next) => { resolve = next; });

  return { promise, resolve };
}
