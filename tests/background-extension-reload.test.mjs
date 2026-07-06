import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bindPendingExtensionReloadNoticeDelivery,
  deliverPendingExtensionReloadNotice,
  extensionReloadNoticeStorageKey,
  handleExtensionReloadUpdate,
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
  assert.deepEqual(calls.slice(0, 1), [
    ['query', { active: true }],
  ]);
  assert.equal(calls[1][0], 'executeScript');
  assert.equal(calls[1][1].target.tabId, 11);
  assert.equal(typeof calls[1][1].func, 'function');
  assert.deepEqual(calls[1][1].args, [{ version: '0.1.0' }]);
  assert.equal(calls[2][0], 'executeScript');
  assert.equal(calls[2][1].target.tabId, 13);
  assert.equal(typeof calls[2][1].func, 'function');
  assert.deepEqual(calls[2][1].args, [{ version: '0.1.0' }]);
  assert.deepEqual(calls.at(-1), ['remove', extensionReloadNoticeStorageKey]);
});

test('pending reload notice injects a dialog into active HTTP tabs across windows', async () => {
  const calls = [];
  const storageValues = {
    [extensionReloadNoticeStorageKey]: {
      createdAt: 12345,
      version: '0.1.0',
    },
  };
  const windowsApi = {
    getAll(query, callback) {
      calls.push(['getAll', query]);
      callback([
        {
          id: 1,
          tabs: [
            { active: true, id: 21, url: 'https://media.example.test/window-1' },
            { active: false, id: 22, url: 'https://media.example.test/inactive' },
          ],
        },
        {
          id: 2,
          tabs: [
            { active: true, id: 31, url: 'https://media.example.test/window-2' },
          ],
        },
        {
          id: 3,
          tabs: [
            { active: true, id: 41, url: 'brave://extensions/?id=dhhmiflbhoaffjmlfpihmpioflgocekg' },
          ],
        },
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
    tabsApi: {
      query(query, callback) {
        calls.push(['query', query]);
        callback([{ active: true, id: 99, url: 'https://media.example.test/fallback' }]);
      },
    },
    windowsApi,
  });

  assert.deepEqual(result, {
    notified: 2,
    prompted: true,
  });
  assert.deepEqual(calls.filter(([type]) => ['getAll', 'query'].includes(type)), [
    ['getAll', { populate: true, windowTypes: ['normal'] }],
  ]);
  assert.deepEqual(
    calls.filter(([type]) => type === 'executeScript').map(([, details]) => details.target.tabId),
    [21, 31],
  );
});

test('extension update stores and delivers a reload notice when no popup notice exists', async () => {
  const calls = [];
  const storageValues = {};
  const tabsApi = {
    query(query, callback) {
      calls.push(['query', query]);
      callback([{ id: 22, url: 'https://media.example.test/post/3' }]);
    },
  };
  const scriptingApi = {
    async executeScript(details) {
      calls.push(['executeScript', details]);
    },
  };

  const result = await handleExtensionReloadUpdate({
    details: { reason: 'update' },
    now: () => 67890,
    runtime: {
      getManifest: () => ({ version: '0.1.0' }),
    },
    scriptingApi,
    storageArea: {
      async get(key) {
        calls.push(['get', key]);
        return { [key]: storageValues[key] };
      },
      async remove(key) {
        calls.push(['remove', key]);
        delete storageValues[key];
      },
      async set(values) {
        calls.push(['set', values]);
        Object.assign(storageValues, values);
      },
    },
    tabsApi,
  });

  assert.deepEqual(result, {
    notified: 1,
    prompted: true,
    recorded: true,
  });
  assert.deepEqual(calls.find(([type]) => type === 'set')?.[1], {
    [extensionReloadNoticeStorageKey]: {
      createdAt: 67890,
      version: '0.1.0',
    },
  });
  const executeCall = calls.find(([type]) => type === 'executeScript');

  assert.equal(executeCall[1].target.tabId, 22);
  assert.deepEqual(executeCall[1].args, [{ version: '0.1.0' }]);
  assert.deepEqual(calls.at(-1), ['remove', extensionReloadNoticeStorageKey]);
});

test('extension update keeps the notice pending until an active HTTP tab can be prompted', async () => {
  const calls = [];
  let activeUrl = 'brave://extensions/?id=dhhmiflbhoaffjmlfpihmpioflgocekg';
  const storageValues = {};
  const tabsApi = {
    query(query, callback) {
      calls.push(['query', query]);
      callback([{ id: 31, url: activeUrl }]);
    },
  };
  const scriptingApi = {
    async executeScript(details) {
      calls.push(['executeScript', details]);
    },
  };

  const result = await handleExtensionReloadUpdate({
    details: { reason: 'update' },
    now: () => 17600,
    runtime: {
      getManifest: () => ({ version: '0.1.0' }),
    },
    scriptingApi,
    storageArea: {
      async get(key) {
        return { [key]: storageValues[key] };
      },
      async remove(key) {
        calls.push(['remove', key]);
        delete storageValues[key];
      },
      async set(values) {
        Object.assign(storageValues, values);
      },
    },
    tabsApi,
  });

  assert.deepEqual(result, {
    notified: 0,
    prompted: false,
    recorded: true,
  });
  assert.deepEqual(calls.filter(([type]) => type === 'query'), [
    ['query', { active: true }],
  ]);
  assert.equal(calls.some(([type]) => type === 'executeScript'), false);
  assert.equal(calls.some(([type]) => type === 'remove'), false);
  assert.deepEqual(storageValues[extensionReloadNoticeStorageKey], {
    createdAt: 17600,
    version: '0.1.0',
  });

  activeUrl = 'https://media.example.test/post/4';

  const retryResult = await deliverPendingExtensionReloadNotice({
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

  assert.deepEqual(retryResult, {
    notified: 1,
    prompted: true,
  });
  assert.equal(storageValues[extensionReloadNoticeStorageKey], undefined);
  assert.equal(calls.at(-2)[0], 'executeScript');
  assert.equal(calls.at(-2)[1].target.tabId, 31);
  assert.deepEqual(calls.at(-1), ['remove', extensionReloadNoticeStorageKey]);
});

test('pending reload notice delivery retries on active tab and window changes', () => {
  const calls = [];
  const listeners = {};
  const eventTarget = (name) => ({
    addListener(listener) {
      listeners[name] = listener;
    },
  });

  bindPendingExtensionReloadNoticeDelivery({
    deliver() {
      calls.push('deliver');
    },
    tabsApi: {
      onActivated: eventTarget('activated'),
      onUpdated: eventTarget('updated'),
    },
    windowsApi: {
      onFocusChanged: eventTarget('focusChanged'),
    },
  });

  listeners.activated();
  listeners.updated(11, { status: 'complete' }, { active: true });
  listeners.updated(12, { status: 'complete' }, { active: false });
  listeners.updated(13, {}, { active: true });
  listeners.focusChanged();

  assert.deepEqual(calls, ['deliver', 'deliver', 'deliver']);
});

test('extension reload notices ignore first installs', async () => {
  const calls = [];

  const result = await handleExtensionReloadUpdate({
    details: { reason: 'install' },
    scriptingApi: {
      async executeScript(details) {
        calls.push(['executeScript', details]);
      },
    },
    storageArea: {
      async get(key) {
        calls.push(['get', key]);
        return {};
      },
      async set(values) {
        calls.push(['set', values]);
      },
    },
    tabsApi: {
      query(query, callback) {
        calls.push(['query', query]);
        callback([{ id: 22, url: 'https://media.example.test/post/3' }]);
      },
    },
  });

  assert.deepEqual(result, {
    notified: 0,
    prompted: false,
    recorded: false,
  });
  assert.deepEqual(calls, []);
});
