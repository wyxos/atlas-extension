import assert from 'node:assert/strict';
import test from 'node:test';

import { loadNextTabsFromActive } from '../src/background/load-next-tabs.js';

test('activates the next 10 tabs after the active tab and restores the active tab', async () => {
  const updateCalls = [];
  const tabs = Array.from({ length: 15 }, (_value, index) => ({
    active: index === 3,
    id: index + 10,
    index,
    windowId: 7,
  }));
  const tabsApi = {
    query(query, callback) {
      assert.deepEqual(query, { windowId: 7 });
      callback(tabs);
    },
    update(tabId, updateProperties, callback) {
      updateCalls.push([tabId, updateProperties]);
      callback({ id: tabId });
    },
  };

  const result = await loadNextTabsFromActive({
    activeTabId: 13,
    tabsApi,
    windowId: 7,
  });

  assert.deepEqual(result, {
    activated: 10,
    limit: 10,
    reloaded: 0,
    restored: true,
    tabIds: [14, 15, 16, 17, 18, 19, 20, 21, 22, 23],
  });
  assert.deepEqual(updateCalls, [
    [14, { active: true }],
    [15, { active: true }],
    [16, { active: true }],
    [17, { active: true }],
    [18, { active: true }],
    [19, { active: true }],
    [20, { active: true }],
    [21, { active: true }],
    [22, { active: true }],
    [23, { active: true }],
    [13, { active: true }],
  ]);
});

test('reloads only a custom number of tabs after the active tab', async () => {
  const calls = [];
  const tabs = Array.from({ length: 16 }, (_value, index) => ({
    active: index === 2,
    id: index + 100,
    index,
    windowId: 7,
  }));
  const tabsApi = {
    query(query, callback) {
      assert.deepEqual(query, { windowId: 7 });
      callback(tabs);
    },
    reload(tabId, callback) {
      calls.push(['reload', tabId]);
      callback();
    },
    update(tabId, updateProperties, callback) {
      calls.push(['update', tabId, updateProperties]);
      callback({ id: tabId });
    },
  };

  const result = await loadNextTabsFromActive({
    activeTabId: 102,
    limit: 12,
    tabsApi,
    windowId: 7,
  });

  assert.deepEqual(result, {
    activated: 0,
    limit: 12,
    reloaded: 12,
    restored: false,
    tabIds: [103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114],
  });
  assert.deepEqual(calls, [
    ['reload', 103],
    ['reload', 104],
    ['reload', 105],
    ['reload', 106],
    ['reload', 107],
    ['reload', 108],
    ['reload', 109],
    ['reload', 110],
    ['reload', 111],
    ['reload', 112],
    ['reload', 113],
    ['reload', 114],
  ]);
});

test('reloads only the following tabs available before the end of the window', async () => {
  const reloadCalls = [];
  const tabs = Array.from({ length: 6 }, (_value, index) => ({
    active: index === 4,
    id: index + 50,
    index,
    windowId: 7,
  }));
  const tabsApi = {
    query(_query, callback) {
      callback(tabs);
    },
    reload(tabId, callback) {
      reloadCalls.push(tabId);
      callback();
    },
  };

  const result = await loadNextTabsFromActive({
    activeTabId: 54,
    limit: 10,
    tabsApi,
    windowId: 7,
  });

  assert.deepEqual(result, {
    activated: 0,
    limit: 10,
    reloaded: 1,
    restored: false,
    tabIds: [55],
  });
  assert.deepEqual(reloadCalls, [55]);
});

test('does not wrap around to tabs before the active tab', async () => {
  const updateCalls = [];
  const tabs = Array.from({ length: 15 }, (_value, index) => ({
    active: index === 12,
    id: index + 10,
    index,
    windowId: 7,
  }));
  const tabsApi = {
    query(_query, callback) {
      callback(tabs);
    },
    update(tabId, updateProperties, callback) {
      updateCalls.push([tabId, updateProperties]);
      callback({ id: tabId });
    },
  };

  const result = await loadNextTabsFromActive({
    activeTabId: 22,
    tabsApi,
    windowId: 7,
  });

  assert.deepEqual(result, {
    activated: 2,
    limit: 10,
    reloaded: 0,
    restored: true,
    tabIds: [23, 24],
  });
  assert.deepEqual(updateCalls, [
    [23, { active: true }],
    [24, { active: true }],
    [22, { active: true }],
  ]);
});

test('reports when the Chrome tabs API cannot load tabs', async () => {
  await assert.rejects(
    () => loadNextTabsFromActive({ tabsApi: null }),
    /Chrome tabs API is unavailable/,
  );
});

test('reloads exactly the next 10 tabs by index by default, excluding the focused tab', async () => {
  const reloaded = [];
  const tabs = Array.from({ length: 15 }, (_, index) => ({
    id: index + 1, index, active: index === 2,
  })).reverse();
  const result = await loadNextTabsFromActive({
    tabsApi: {
      query(query, callback) {
        assert.deepEqual(query, { currentWindow: true });
        callback(tabs);
      },
      reload(id, _options, callback) {
        reloaded.push(id);
        callback();
      },
    },
  });
  assert.deepEqual(reloaded, [4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  assert.deepEqual(result.tabIds, reloaded);
  assert.equal(result.reloaded, 10);
});

test('does nothing when the active tab is last in its window', async () => {
  const result = await loadNextTabsFromActive({
    tabsApi: {
      query(_query, callback) {
        callback([{ id: 1, index: 0 }, { id: 2, index: 1, active: true }]);
      },
      reload() { assert.fail('No tab should be reloaded'); },
      update() { assert.fail('No tab should be activated'); },
    },
  });
  assert.deepEqual(result, {
    activated: 0, limit: 10, reloaded: 0, restored: false, tabIds: [],
  });
});

test('wakes frozen and discarded targets before reloading and restores original focus', async () => {
  const calls = [];
  const result = await loadNextTabsFromActive({
    limit: 3,
    tabsApi: {
      query(_query, callback) {
        callback([
          { id: 1, index: 0, active: true },
          { id: 2, index: 1, frozen: true },
          { id: 3, index: 2, discarded: true },
          { id: 4, index: 3 },
          { id: 5, index: 4, frozen: true },
        ]);
      },
      update(id, properties, callback) {
        assert.deepEqual(properties, { active: true });
        calls.push(['activate', id]);
        callback({ id });
      },
      reload(id, callback) {
        calls.push(['reload', id]);
        callback();
      },
    },
  });
  assert.deepEqual(calls, [
    ['activate', 2], ['reload', 2],
    ['activate', 3], ['reload', 3],
    ['reload', 4], ['activate', 1],
  ]);
  assert.deepEqual(result, {
    activated: 2, limit: 3, reloaded: 3, restored: true, tabIds: [2, 3, 4],
  });
});

test('restores original focus even when reloading a woken tab fails', async () => {
  const calls = [];
  const runtime = {};
  await assert.rejects(loadNextTabsFromActive({
    runtime,
    tabsApi: {
      query(_query, callback) {
        callback([{ id: 1, index: 0, active: true }, { id: 2, index: 1, frozen: true }]);
      },
      update(id, _properties, callback) {
        calls.push(id);
        callback({ id });
      },
      reload(_id, callback) {
        runtime.lastError = { message: 'Reload failed' };
        callback();
        delete runtime.lastError;
      },
    },
  }), /Reload failed/);
  assert.deepEqual(calls, [2, 1]);
});
