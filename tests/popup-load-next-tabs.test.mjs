import assert from 'node:assert/strict';
import test from 'node:test';

import { loadNextTabsRequestType } from '../src/shared/load-next-tabs-messages.js';
import { requestNextTabsLoad } from '../src/popup/load-next-tabs.js';

test('popup asks the background worker to load tabs after the current active tab', async () => {
  const calls = [];
  const tabsApi = {
    query(query, callback) {
      calls.push(['query', query]);
      callback([{ id: 42, windowId: 7 }]);
    },
  };
  const runtime = {
    sendMessage(message, callback) {
      calls.push(['sendMessage', message]);
      callback({
        ok: true,
        payload: {
          activated: 10,
          limit: 10,
          reloaded: 1,
          restored: true,
          tabIds: [43, 44, 45],
        },
      });
    },
  };

  const result = await requestNextTabsLoad({ runtime, tabsApi });

  assert.deepEqual(result, {
    activated: 10,
    ok: true,
    reloaded: 1,
    restored: true,
  });
  assert.deepEqual(calls, [
    ['query', { active: true, currentWindow: true }],
    ['sendMessage', {
      activeTabId: 42,
      limit: 10,
      type: loadNextTabsRequestType,
      windowId: 7,
    }],
  ]);
});

test('popup forwards a custom next-tab limit to the background worker', async () => {
  const calls = [];
  const tabsApi = {
    query(query, callback) {
      calls.push(['query', query]);
      callback([{ id: 42, windowId: 7 }]);
    },
  };
  const runtime = {
    sendMessage(message, callback) {
      calls.push(['sendMessage', message]);
      callback({
        ok: true,
        payload: {
          activated: 12,
          limit: 12,
          reloaded: 1,
          restored: true,
          tabIds: [43, 44],
        },
      });
    },
  };

  const result = await requestNextTabsLoad({ limit: 12, runtime, tabsApi });

  assert.deepEqual(result, {
    activated: 12,
    ok: true,
    reloaded: 1,
    restored: true,
  });
  assert.deepEqual(calls[1], ['sendMessage', {
    activeTabId: 42,
    limit: 12,
    type: loadNextTabsRequestType,
    windowId: 7,
  }]);
});

test('popup reports when no active tab is available', async () => {
  const runtime = {
    sendMessage() {},
  };
  const tabsApi = {
    query(_query, callback) {
      callback([]);
    },
  };

  const result = await requestNextTabsLoad({ runtime, tabsApi });

  assert.deepEqual(result, {
    error: 'No active tab is available.',
    ok: false,
  });
});
