import assert from 'node:assert/strict';
import test from 'node:test';

import { requestActiveTabScan } from '../src/popup/scan-active-tab.js';

test('popup scan sends a manual scan request to the active tab', async () => {
  const calls = [];
  const tabsApi = {
    query(query, callback) {
      calls.push(['query', query]);
      callback([{ id: 42, url: 'https://www.example.test/post/1' }]);
    },
    sendMessage(tabId, message, callback) {
      calls.push(['sendMessage', tabId, message]);
      callback({ ok: true, payload: { scanned: true } });
    },
  };

  const result = await requestActiveTabScan({ tabsApi });

  assert.deepEqual(result, { ok: true, scanned: true });
  assert.deepEqual(calls, [
    ['query', { active: true, currentWindow: true }],
    ['sendMessage', 42, { type: 'atlas-extension.manual-scan' }],
  ]);
});

test('popup scan reports when no active tab can receive the request', async () => {
  const tabsApi = {
    query(_query, callback) {
      callback([{ url: 'https://www.example.test/post/1' }]);
    },
  };

  const result = await requestActiveTabScan({ tabsApi });

  assert.deepEqual(result, {
    error: 'No active tab is available.',
    ok: false,
  });
});

test('popup scan reports content-script messaging errors', async () => {
  const runtime = {
    lastError: {
      message: 'Could not establish connection. Receiving end does not exist.',
    },
  };
  const tabsApi = {
    query(_query, callback) {
      callback([{ id: 42 }]);
    },
    sendMessage(_tabId, _message, callback) {
      callback();
    },
  };

  const result = await requestActiveTabScan({ runtime, tabsApi });

  assert.deepEqual(result, {
    error: 'Could not establish connection. Receiving end does not exist.',
    ok: false,
  });
});
