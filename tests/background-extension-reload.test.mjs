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
    tabsApi: {
      query(_query, callback) {
        callback([
          { id: 7, status: 'complete', url: 'https://media.example.test/post/1' },
          { id: 8, status: 'complete', url: 'chrome://extensions/' },
        ]);
      },
    },
  });

  assert.deepEqual(result, { reloading: true });
  assert.deepEqual(storedValues[extensionReloadNoticeStorageKey], {
    createdAt: 12345,
    pendingTabIds: [7],
    version: '0.1.0',
  });
  assert.equal(reloads, 0);
  assert.equal(scheduledCallbacks.length, 1);
  assert.equal(scheduledCallbacks[0][1], 0);

  scheduledCallbacks[0][0]();

  assert.equal(reloads, 1);
});

test('pending reload notice injects a dialog into every loaded HTTP tab', async () => {
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
        { active: true, id: 11, status: 'complete', url: 'https://media.example.test/post/1' },
        { id: 12, status: 'complete', url: 'chrome://extensions/' },
        { active: false, id: 13, status: 'complete', url: 'http://media.example.test/post/2' },
        { discarded: true, id: 14, status: 'unloaded', url: 'https://media.example.test/sleeping' },
        { frozen: true, id: 15, status: 'complete', url: 'https://media.example.test/frozen' },
        { discarded: false, id: 16, status: 'unloaded', url: 'https://media.example.test/lazy' },
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
    ['query', {}],
  ]);
  assert.equal(calls[1][0], 'executeScript');
  assert.equal(calls[1][1].target.tabId, 11);
  assert.equal(typeof calls[1][1].func, 'function');
  assert.deepEqual(calls[1][1].args, [
    { version: '0.1.0' },
    'atlas-extension.reload-all-tabs',
  ]);
  assert.equal(calls[2][0], 'executeScript');
  assert.equal(calls[2][1].target.tabId, 13);
  assert.equal(typeof calls[2][1].func, 'function');
  assert.deepEqual(calls[2][1].args, [
    { version: '0.1.0' },
    'atlas-extension.reload-all-tabs',
  ]);
  assert.deepEqual(calls.at(-1), ['remove', extensionReloadNoticeStorageKey]);
});

test('pending reload notice injects a dialog into loaded HTTP tabs across windows', async () => {
  const calls = [];
  const storageValues = {
    [extensionReloadNoticeStorageKey]: {
      createdAt: 12345,
      version: '0.1.0',
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
        callback([
          { active: true, id: 21, status: 'complete', url: 'https://media.example.test/window-1', windowId: 1 },
          { active: false, id: 22, status: 'complete', url: 'https://media.example.test/background', windowId: 1 },
          { active: true, id: 31, status: 'complete', url: 'https://media.example.test/window-2', windowId: 2 },
          { active: true, id: 41, status: 'complete', url: 'brave://extensions/', windowId: 3 },
        ]);
      },
    },
  });

  assert.deepEqual(result, {
    notified: 3,
    prompted: true,
  });
  assert.deepEqual(calls.filter(([type]) => type === 'query'), [
    ['query', {}],
  ]);
  assert.deepEqual(
    calls.filter(([type]) => type === 'executeScript').map(([, details]) => details.target.tabId),
    [21, 22, 31],
  );
});

test('one slow loaded tab does not block dialog injection into the others', async () => {
  let releaseFirstInjection;
  let secondInjectionStarted = false;
  const storageValues = {
    [extensionReloadNoticeStorageKey]: {
      createdAt: 12345,
      pendingTabIds: [46, 47],
      version: '0.1.0',
    },
  };

  const result = await deliverPendingExtensionReloadNotice({
    scriptingApi: {
      async executeScript({ target }) {
        if (target.tabId === 46) {
          await new Promise((resolve) => {
            releaseFirstInjection = resolve;
          });

          return;
        }

        secondInjectionStarted = true;
        releaseFirstInjection();
      },
    },
    storageArea: {
      async get(key) {
        return { [key]: storageValues[key] };
      },
      async remove(key) {
        delete storageValues[key];
      },
    },
    tabsApi: {
      query(_query, callback) {
        callback([
          { discarded: false, id: 46, status: 'complete', url: 'https://media.example.test/slow' },
          { discarded: false, id: 47, status: 'complete', url: 'https://media.example.test/ready' },
        ]);
      },
    },
  });

  assert.equal(secondInjectionStarted, true);
  assert.deepEqual(result, { notified: 2, prompted: true });
});

test('loaded-tab injection failures remain pending for a later retry', async () => {
  const calls = [];
  const storageValues = {
    [extensionReloadNoticeStorageKey]: {
      createdAt: 12345,
      pendingTabIds: [51, 52],
      version: '0.1.0',
    },
  };

  const result = await deliverPendingExtensionReloadNotice({
    scriptingApi: {
      async executeScript({ target }) {
        calls.push(['executeScript', target.tabId]);

        if (target.tabId === 52) {
          throw new Error('Transient injection failure');
        }
      },
    },
    storageArea: {
      async get(key) {
        return { [key]: storageValues[key] };
      },
      async set(values) {
        Object.assign(storageValues, values);
      },
    },
    tabsApi: {
      query(_query, callback) {
        callback([
          { id: 51, status: 'complete', url: 'https://media.example.test/loaded' },
          { discarded: false, id: 52, status: 'complete', url: 'https://media.example.test/loaded-2' },
        ]);
      },
    },
  });

  assert.deepEqual(result, { notified: 1, prompted: true });
  assert.deepEqual(calls, [
    ['executeScript', 51],
    ['executeScript', 52],
  ]);
  assert.deepEqual(storageValues[extensionReloadNoticeStorageKey], {
    createdAt: 12345,
    pendingTabIds: [52],
    version: '0.1.0',
  });
});

test('extension update replaces stale pending tabs with a fresh loaded-tab snapshot', async () => {
  const calls = [];
  const storageValues = {
    [extensionReloadNoticeStorageKey]: {
      createdAt: 12345,
      pendingTabIds: [999],
      version: '0.1.0',
    },
  };
  const tabsApi = {
    query(query, callback) {
      calls.push(['query', query]);
      callback([{ id: 22, status: 'complete', url: 'https://media.example.test/post/3' }]);
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
      pendingTabIds: [22],
      version: '0.1.0',
    },
  });
  const executeCall = calls.find(([type]) => type === 'executeScript');

  assert.equal(executeCall[1].target.tabId, 22);
  assert.equal(calls.some(([type, details]) => (
    type === 'executeScript' && details.target.tabId === 999
  )), false);
  assert.deepEqual(executeCall[1].args, [
    { version: '0.1.0' },
    'atlas-extension.reload-all-tabs',
  ]);
  assert.deepEqual(calls.at(-1), ['remove', extensionReloadNoticeStorageKey]);
});

test('extension update targets loaded tabs and ignores sleeping tabs', async () => {
  const calls = [];
  let canInject = false;
  const storageValues = {};
  const tabsApi = {
    query(query, callback) {
      calls.push(['query', query]);
      callback([
        { discarded: false, id: 31, status: 'complete', url: 'https://media.example.test/post/4' },
        { discarded: true, id: 32, status: 'unloaded', url: 'https://media.example.test/sleeping' },
      ]);
    },
  };
  const scriptingApi = {
    async executeScript(details) {
      calls.push(['executeScript', details]);

      if (!canInject) {
        throw new Error('Transient injection failure');
      }
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
    ['query', {}],
    ['query', {}],
  ]);
  assert.equal(calls.some(([type]) => type === 'executeScript'), true);
  assert.equal(calls.some(([type]) => type === 'remove'), false);
  assert.deepEqual(storageValues[extensionReloadNoticeStorageKey], {
    createdAt: 17600,
    pendingTabIds: [31],
    version: '0.1.0',
  });

  canInject = true;

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
        callback([{ id: 22, status: 'complete', url: 'https://media.example.test/post/3' }]);
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
