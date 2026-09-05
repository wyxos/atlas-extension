import assert from 'node:assert/strict';
import test from 'node:test';
import {
  initializeNextTabsLimit,
  loadNextTabsLimitStorageKey,
} from '../src/popup/load-next-tabs-limit.js';

function control() {
  const handlers = new Map();
  return {
    value: '',
    addEventListener(type, handler) { handlers.set(type, handler); },
    fire(type) { handlers.get(type)?.(); },
  };
}

function openPopup(storage, onError) {
  const input = control();
  const decrementButton = control();
  const incrementButton = control();
  const state = initializeNextTabsLimit({
    input, decrementButton, incrementButton, storage, onError,
  });
  return { ...state, input, decrementButton, incrementButton };
}

function createStorage(initial = {}) {
  const values = { ...initial };
  return {
    async get(key) { return { [key]: values[key] }; },
    async set(update) { Object.assign(values, update); },
  };
}

test('remembers increments and decrements when a new popup session opens', async () => {
  const storage = createStorage();
  const first = openPopup(storage);
  await first.ready;
  assert.equal(first.input.value, '10');
  first.incrementButton.fire('click');
  first.incrementButton.fire('click');
  assert.equal(first.input.value, '12');

  const second = openPopup(storage);
  await second.ready;
  assert.equal(second.input.value, '12');
  second.decrementButton.fire('click');

  const third = openPopup(storage);
  await third.ready;
  assert.equal(third.input.value, '11');
});

test('persists typed values without requiring blur or a load action', async () => {
  const storage = createStorage();
  const first = openPopup(storage);
  await first.ready;
  first.input.value = '25';
  first.input.fire('input');
  const second = openPopup(storage);
  await second.ready;
  assert.equal(second.input.value, '25');
});

test('normalizes stored values and saves bounded input on blur', async () => {
  const storage = createStorage({ [loadNextTabsLimitStorageKey]: 'invalid' });
  const first = openPopup(storage);
  await first.ready;
  assert.equal(first.input.value, '10');
  first.input.value = '150';
  first.input.fire('blur');
  assert.equal(first.input.value, '99');
  const second = openPopup(storage);
  await second.ready;
  assert.equal(second.input.value, '99');
  second.input.value = '';
  assert.equal(second.normalize(), 10);
  const third = openPopup(storage);
  await third.ready;
  assert.equal(third.input.value, '10');
});

test('a delayed storage read does not overwrite a new count', async () => {
  let resolveRead;
  const writes = [];
  const popup = openPopup({
    get: () => new Promise((resolve) => { resolveRead = resolve; }),
    async set(value) { writes.push(value); },
  });
  popup.incrementButton.fire('click');
  resolveRead({ [loadNextTabsLimitStorageKey]: 22 });
  await popup.ready;
  assert.equal(popup.input.value, '11');
  assert.deepEqual(writes, [{ [loadNextTabsLimitStorageKey]: 11 }]);
});

test('storage errors are reported while the count controls remain usable', async () => {
  const errors = [];
  const popup = openPopup({
    async get() { throw new Error('Read failed'); },
    async set() { throw new Error('Write failed'); },
  }, (message) => errors.push(message));
  await popup.ready;
  assert.equal(popup.input.value, '10');
  popup.incrementButton.fire('click');
  await Promise.resolve();
  assert.equal(popup.input.value, '11');
  assert.deepEqual(errors, [
    'The saved tab count could not be read.',
    'The tab count could not be saved.',
  ]);
});
