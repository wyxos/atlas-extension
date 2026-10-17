import assert from 'node:assert/strict';
import test from 'node:test';
import { trackOpenTabs, replyWithOpenTabCounts } from '../src/background/open-tab-tracking.js';
import { createOpenTabRegistry } from '../src/background/tab-state.js';
import { resolveReferrerBadgeState } from '../src/content/referrer-state.js';
import { handleTabCounterSnapshotRequest } from '../src/background/tab-counter.js';

const pageA = 'https://example.test/a';
const links = ['b', 'c', 'd'].map(name => `https://example.test/${name}`);
const restored = [pageA, ...links].map((url, id) => ({ id, url, windowId: 1 }));

function fixture() {
  const events = {};
  const tabsApi = {};
  let finishQuery;
  for (const name of ['onCreated', 'onUpdated', 'onRemoved', 'onDetached', 'onAttached']) {
    tabsApi[name] = { addListener(fn) { events[name] = fn; } };
  }
  tabsApi.query = (_query, callback) => { finishQuery = callback; };
  const openTabs = createOpenTabRegistry();
  const updates = [];
  const counters = [];
  const ready = trackOpenTabs({ tabsApi, openTabs,
    onCountsChanged: urls => updates.push({ urls, counts: openTabs.getCounts(urls) }),
    onCountersChanged: ids => counters.push(ids),
  });
  return { openTabs, ready, events, updates, counters, finish: tabs => finishQuery(tabs) };
}

test('badge requests wait for restored tabs rather than caching an empty startup snapshot', async () => {
  const f = fixture();
  let response;
  const reply = replyWithOpenTabCounts({ ready: f.ready, openTabs: f.openTabs,
    message: { referrerUrls: links }, sendResponse: value => { response = value; } });
  assert.equal(response, undefined);
  f.finish(restored);
  await reply;
  assert.equal(response.ok, true);
  for (const referrerUrl of links) {
    assert.deepEqual(resolveReferrerBadgeState({ atlasState: {}, currentPageUrl: pageA,
      referrerUrl, openCounts: response.payload.counts }), { referrerStatus: 'opened-elsewhere' });
  }
});

test('initial snapshot pushes counts to existing content scripts; closing a restored tab clears its badge', async () => {
  const f = fixture();
  f.finish(restored);
  await f.ready;
  assert.equal(f.updates.length, 1);
  assert.deepEqual(f.updates[0].counts, Object.fromEntries(restored.map(tab => [tab.url, 1])));
  assert.deepEqual(f.counters, [[1]]);
  f.events.onRemoved(1);
  assert.deepEqual(f.updates.at(-1), { urls: [links[0]], counts: {} });
  assert.deepEqual(f.openTabs.getCounts(links), { [links[1]]: 1, [links[2]]: 1 });
});

test('restored tabs with pending URLs count before their pages load', async () => {
  const f = fixture();
  f.finish(restored.map(({ url, ...tab }) => ({ ...tab, pendingUrl: url, discarded: true })));
  await f.ready;
  assert.deepEqual(f.openTabs.getCounts(links), Object.fromEntries(links.map(url => [url, 1])));
  f.events.onCreated({ id: 9, pendingUrl: 'https://example.test/e', windowId: 1 });
  f.events.onUpdated(9, { status: 'loading' }, { id: 9, pendingUrl: 'https://example.test/f', windowId: 1 });
  assert.equal(f.openTabs.getCounts()['https://example.test/f'], 1);
  assert.equal(f.openTabs.getCounts()['https://example.test/e'], undefined);
});

test('tab events during the initial query survive its older snapshot without transient broadcasts', async () => {
  const f = fixture();
  f.events.onRemoved(1);
  f.events.onUpdated(2, { url: 'https://example.test/new-c' }, { ...restored[2], url: 'https://example.test/new-c' });
  f.events.onCreated({ id: 4, url: 'https://example.test/e', windowId: 2 });
  f.events.onDetached(3, { oldWindowId: 1 });
  f.events.onAttached(3, { newWindowId: 2 });
  assert.equal(f.updates.length, 0);
  f.finish(restored);
  await f.ready;
  assert.equal(f.updates.length, 1);
  assert.deepEqual(f.openTabs.getCounts(), {
    [pageA]: 1, [links[2]]: 1, 'https://example.test/new-c': 1, 'https://example.test/e': 1,
  });
  assert(f.updates[0].urls.includes(links[0]), 'removed URL must publish a zero count');
  assert.equal(f.openTabs.getWindowId(3), 2);
  assert.deepEqual(f.openTabs.getTabCounter(3), { domain: 'example.test', sameDomainTabs: 2, totalTabsInWindow: 2 });
});

test('failed initial query completes readiness and retains tab events', async () => {
  const f = fixture();
  f.events.onCreated(restored[1]);
  f.finish(undefined);
  await f.ready;
  assert.deepEqual(f.openTabs.getCounts(), { [links[0]]: 1 });
});

test('a tab-counter request delayed by startup cannot resurrect a closed tab', async () => {
  const f = fixture();
  const reply = f.ready.then(() => handleTabCounterSnapshotRequest({
    message: { currentUrl: links[0] }, openTabs: f.openTabs,
    sender: { tab: restored[1] }, refreshSender: false,
  }));
  f.events.onRemoved(1);
  f.finish(restored);
  assert.equal(await reply, null);
  assert.equal(f.openTabs.getCounts()[links[0]], undefined);
});
