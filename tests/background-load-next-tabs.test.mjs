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
    restored: true,
    tabIds: [23, 24],
  });
  assert.deepEqual(updateCalls, [
    [23, { active: true }],
    [24, { active: true }],
    [22, { active: true }],
  ]);
});

test('reports when the Chrome tabs API cannot activate tabs', async () => {
  await assert.rejects(
    () => loadNextTabsFromActive({ tabsApi: null }),
    /Chrome tabs API is unavailable/,
  );
});
