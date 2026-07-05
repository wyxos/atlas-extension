import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deliverPendingExtensionReloadNotice,
  extensionReloadNoticeStorageKey,
  handleExtensionReloadRequest,
} from '../src/background/extension-reload.js';

test('reload request stores a pending notice before reloading the extension', async () => {
  const storedValues = {};
  const scheduledCallbacks = [];
  let reloads = 0;

  const result = await handleExtensionReloadRequest({
    now: () => 12345,
    runtime: {
      getManifest: () => ({ version: '0.1.0' }),
      reload() {
        reloads += 1;
      },
    },
    setTimeout: (callback, delay) => {
      scheduledCallbacks.push([callback, delay]);
    },
    storageArea: {
      async set(values) {
        Object.assign(storedValues, values);
      },
    },
  });

  assert.deepEqual(result, { reloading: true });
  assert.deepEqual(storedValues[extensionReloadNoticeStorageKey], {
    createdAt: 12345,
    version: '0.1.0',
  });
  assert.equal(reloads, 0);
  assert.equal(scheduledCallbacks.length, 1);
  assert.equal(scheduledCallbacks[0][1], 0);

  scheduledCallbacks[0][0]();

  assert.equal(reloads, 1);
});

test('pending reload notice injects a dialog into active HTTP tabs', async () => {
  const calls = [];
  const storageValues = {
    [extensionReloadNoticeStorageKey]: {
      createdAt: 12345,
      version: '0.1.0',
    },
  };
  const tabsApi = {
    query(query, callback) {
      calls.push(['query', query]);
      callback([
        { id: 11, url: 'https://media.example.test/post/1' },
        { id: 12, url: 'chrome://extensions/' },
        { id: 13, url: 'http://media.example.test/post/2' },
      ]);
    },
  };
  const scriptingApi = {
    async executeScript(details) {
      calls.push(['executeScript', details]);
    },
  };

  const result = await deliverPendingExtensionReloadNotice({
    scriptingApi,
    storageArea: {
      async get(key) {
        return { [key]: storageValues[key] };
      },
      async remove(key) {
        calls.push(['remove', key]);
        delete storageValues[key];
      },
    },
    tabsApi,
  });

  assert.deepEqual(result, {
    notified: 2,
    prompted: true,
  });
  assert.deepEqual(calls.slice(0, 2), [
    ['remove', extensionReloadNoticeStorageKey],
    ['query', { active: true }],
  ]);
  assert.equal(calls[2][0], 'executeScript');
  assert.equal(calls[2][1].target.tabId, 11);
  assert.equal(typeof calls[2][1].func, 'function');
  assert.deepEqual(calls[2][1].args, [{ version: '0.1.0' }]);
  assert.equal(calls[3][0], 'executeScript');
  assert.equal(calls[3][1].target.tabId, 13);
  assert.equal(typeof calls[3][1].func, 'function');
  assert.deepEqual(calls[3][1].args, [{ version: '0.1.0' }]);
});
