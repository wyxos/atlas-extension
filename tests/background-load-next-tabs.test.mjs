import assert from 'node:assert/strict';
import test from 'node:test';
import { loadNextTabsFromActive } from '../src/background/load-next-tabs.js';

function fixture({ active = 2, count = 16, fail = -1 } = {}) {
  const runtime = {};
  const calls = [];
  const tabs = Array.from({ length: count }, (_, index) => ({ id: index + 1, index, active: index === active, discarded: index % 2 === 0, frozen: index % 2 === 1 }));
  return { runtime, calls, tabs, tabsApi: {
    query(_query, cb) { cb([...tabs].reverse()); },
    update() { assert.fail('Focus must never change'); },
    reload(id, _options, cb) {
      calls.push(id);
      if (id === fail) runtime.lastError = { message: 'Reload failed' };
      cb();
      delete runtime.lastError;
    },
  } };
}

test('reloads the next ten siblings, including frozen/discarded tabs, without touching the active tab', async () => {
  const f = fixture();
  const result = await loadNextTabsFromActive(f);
  assert.deepEqual(f.calls, [4,5,6,7,8,9,10,11,12,13]);
  assert.equal(result.activated, 0);
  assert.equal(result.restored, false);
  assert.equal(result.reloaded, 10);
});
test('honors requested count and window', async () => {
  const f = fixture();
  f.tabsApi.query = (query, cb) => { assert.deepEqual(query, { windowId: 7 }); cb(f.tabs); };
  await loadNextTabsFromActive({ ...f, activeTabId: 3, limit: 2, windowId: 7 });
  assert.deepEqual(f.calls, [4,5]);
});
test('does not wrap around the window', async () => {
  const f = fixture({ active: 14 });
  await loadNextTabsFromActive(f);
  assert.deepEqual(f.calls, [16]);
});
test('last tab is untouched', async () => {
  const f = fixture({ active: 15 });
  await loadNextTabsFromActive(f);
  assert.deepEqual(f.calls, []);
});
test('continues remaining siblings after failure and reports partial results', async () => {
  const f = fixture({ fail: 5 });
  await assert.rejects(loadNextTabsFromActive({ ...f, limit: 3 }), /Reloaded 2 tabs; 1 tabs could not be reloaded/);
  assert.deepEqual(f.calls, [4,5,6]);
});
test('a vanished origin does not select a different active tab', async () => {
  const f = fixture();
  await assert.rejects(loadNextTabsFromActive({ ...f, activeTabId: 999 }), /No active tab/);
  assert.deepEqual(f.calls, []);
});
test('missing reload support does not fall back to activation', async () => {
  const f = fixture();
  delete f.tabsApi.reload;
  await assert.rejects(loadNextTabsFromActive(f), /API is unavailable/);
});
test('query errors are reported', async () => {
  const f = fixture();
  f.tabsApi.query = (_query, cb) => { f.runtime.lastError = { message: 'Query failed' }; cb([]); };
  await assert.rejects(loadNextTabsFromActive(f), /Query failed/);
});
