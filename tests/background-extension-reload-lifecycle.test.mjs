import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deliverPendingExtensionReloadNotice,
  extensionReloadNoticeStorageKey,
  handleExtensionReloadUpdate,
} from '../src/background/extension-reload.js';

test('a stuck tab injection times out without locking later delivery attempts', async () => {
  const storageValues = {
    [extensionReloadNoticeStorageKey]: {
      createdAt: 12345,
      pendingTabIds: [48],
      version: '0.1.0',
    },
  };
  const storageArea = {
    async get(key) {
      return { [key]: storageValues[key] };
    },
    async set(values) {
      Object.assign(storageValues, values);
    },
  };
  const tabsApi = {
    query(_query, callback) {
      callback([
        { discarded: false, id: 48, status: 'complete', url: 'https://media.example.test/stuck' },
      ]);
    },
  };

  const firstResult = await deliverPendingExtensionReloadNotice({
    injectionTimeoutMs: 5,
    scriptingApi: {
      executeScript() {
        return new Promise(() => {});
      },
    },
    storageArea,
    tabsApi,
  });

  assert.deepEqual(firstResult, { notified: 0, prompted: false });
  assert.deepEqual(storageValues[extensionReloadNoticeStorageKey].pendingTabIds, [48]);

  const retryResult = await deliverPendingExtensionReloadNotice({
    scriptingApi: {
      async executeScript() {},
    },
    storageArea: {
      ...storageArea,
      async remove(key) {
        delete storageValues[key];
      },
    },
    tabsApi,
  });

  assert.deepEqual(retryResult, { notified: 1, prompted: true });
  assert.equal(storageValues[extensionReloadNoticeStorageKey], undefined);
});

test('extension update supersedes an older stuck delivery immediately', async () => {
  const storageValues = {
    [extensionReloadNoticeStorageKey]: {
      createdAt: 12345,
      pendingTabIds: [999],
      version: '0.1.0',
    },
  };
  const storageArea = {
    async get(key) {
      return { [key]: storageValues[key] };
    },
    async remove(key) {
      delete storageValues[key];
    },
    async set(values) {
      Object.assign(storageValues, values);
    },
  };
  const staleDelivery = deliverPendingExtensionReloadNotice({
    injectionTimeoutMs: 30,
    scriptingApi: {
      executeScript() {
        return new Promise(() => {});
      },
    },
    storageArea,
    tabsApi: {
      query(_query, callback) {
        callback([
          { id: 999, status: 'complete', url: 'https://media.example.test/stale' },
        ]);
      },
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 0));

  const updateResult = await handleExtensionReloadUpdate({
    details: { reason: 'update' },
    now: () => 67890,
    runtime: {
      getManifest: () => ({ version: '0.1.0' }),
    },
    scriptingApi: {
      async executeScript() {},
    },
    storageArea,
    tabsApi: {
      query(_query, callback) {
        callback([
          { id: 22, status: 'complete', url: 'https://media.example.test/fresh' },
        ]);
      },
    },
  });

  assert.deepEqual(updateResult, {
    notified: 1,
    prompted: true,
    recorded: true,
  });
  assert.equal(storageValues[extensionReloadNoticeStorageKey], undefined);

  await staleDelivery;

  assert.equal(storageValues[extensionReloadNoticeStorageKey], undefined);
});
