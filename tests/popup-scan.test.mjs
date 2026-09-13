import assert from 'node:assert/strict';
import test from 'node:test';
const navigationApi = { getAllFrames: (_query, callback) => callback([{ frameId: 0 }]) };

test('popup scan rejects missing or incomplete scan acknowledgements', async () => {
  for (const response of [undefined, {}, { ok: true }, { ok: true, payload: { scanned: false } }]) {
    const result = await requestActiveTabScan({
      navigationApi,
      tabsApi: {
        query: (_query, callback) => callback([{ id: 42 }]),
        sendMessage: (_tabId, _message, _target, callback) => callback(response),
      },
    });
    assert.deepEqual(result, { ok: false, error: 'The page did not confirm the scan. Try again.' });
  }
});

import { requestActiveTabScan } from '../src/popup/scan-active-tab.js';

test('scan waits for every frame and targets the enumerated documents', async () => {
  const calls = [];
  let finishChild;
  const request = requestActiveTabScan({
    navigationApi: { getAllFrames: (_query, callback) => callback([
      { frameId: 0, documentId: 'parent' }, { frameId: 7, documentId: 'child' },
    ]) },
    tabsApi: {
      query: (_query, callback) => callback([{ id: 42 }]),
      sendMessage: (_tabId, _message, target, callback) => {
        calls.push(target);
        if (target.documentId === 'child') finishChild = callback;
        else callback({ ok: true, payload: { scanned: true } });
      },
    },
  });
  let completed = false;
  void request.then(() => { completed = true; });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(completed, false);
  assert.deepEqual(calls, [{ documentId: 'parent' }, { documentId: 'child' }]);
  finishChild({ ok: true, payload: { scanned: true } });
  assert.deepEqual(await request, { ok: true, scanned: true });
});

test('an inaccessible iframe cannot be hidden by a successful main-page scan', async () => {
  const result = await requestActiveTabScan({
    navigationApi: { getAllFrames: (_query, callback) => callback([{ frameId: 0 }, { frameId: 3 }]) },
    tabsApi: {
      query: (_query, callback) => callback([{ id: 42 }]),
      sendMessage: (_tabId, _message, target, callback) => callback(target.frameId === 0
        ? { ok: true, payload: { scanned: true } } : undefined),
    },
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /Scanned 1 of 2 page frames/);
});

test('popup scan sends a manual scan request to the active tab', async () => {
  const calls = [];
  const tabsApi = {
    query(query, callback) {
      calls.push(['query', query]);
      callback([{ id: 42, url: 'https://www.example.test/post/1' }]);
    },
    sendMessage(tabId, message, target, callback) {
      calls.push(['sendMessage', tabId, message, target]);
      callback({ ok: true, payload: { scanned: true } });
    },
  };

  const result = await requestActiveTabScan({ tabsApi, navigationApi });

  assert.deepEqual(result, { ok: true, scanned: true });
  assert.deepEqual(calls, [
    ['query', { active: true, currentWindow: true }],
    ['sendMessage', 42, { type: 'atlas-extension.manual-scan' }, { frameId: 0 }],
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
  const runtime = {};
  const tabsApi = {
    query(_query, callback) {
      callback([{ id: 42 }]);
    },
    sendMessage(_tabId, _message, _target, callback) {
      runtime.lastError = { message: 'Could not establish connection. Receiving end does not exist.' };
      callback();
      delete runtime.lastError;
    },
  };

  const result = await requestActiveTabScan({ runtime, tabsApi, navigationApi });

  assert.deepEqual(result, {
    error: 'Could not establish connection. Receiving end does not exist.',
    ok: false,
  });
});
