import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrowserResolutionCache } from '../src/shared/browser-resolution-cache.js';
import { createBrowserReferrers, createCoalescedDownloadRelay } from '../src/background/browser-referrers.js';
import { createContentInterestRegistry } from '../src/background/content-interest-registry.js';
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise(done => globalThis.setImmediate(done));
const response = pages => ({ pages: pages.map(({ url }) => ({ url, canonicalPage: url.split('?')[0] })) });

test('concurrent progress lookups share one bounded request and failure retries wait for resync', async () => {
  const gate = deferred(); let calls = 0;
  const cache = createBrowserResolutionCache({ resolve: async ({ pages }) => { calls++; await gate.promise; return response(pages); } });
  const requests = Array.from({ length: 1000 }, () => cache.prepare(['https://example.test/post?variant=1']));
  await tick(); assert.equal(calls, 1); gate.resolve();
  await Promise.all(requests); assert.equal(calls, 1);
  let failures = 0;
  const offline = createBrowserResolutionCache({ resolve: async () => { failures++; throw new Error('offline'); } });
  for (let i = 0; i < 20; i++) await offline.prepare(['https://example.test/']);
  assert.equal(failures, 1); offline.clear(); await offline.prepare(['https://example.test/']); assert.equal(failures, 2);
});

test('canonical snapshots outlive LRU eviction and reject invalid UTF8 inputs without poisoning valid pages', async () => {
  const batches = [];
  const cache = createBrowserResolutionCache({ limit: 2, resolve: async ({ pages }) => { batches.push(pages); return response(pages); } });
  const first = await cache.prepare(['https://example.test/first?a=1']);
  await cache.prepare(['https://example.test/second?a=1', 'https://example.test/third?a=1']);
  assert.equal(cache.canonical('https://example.test/first?a=1'), 'https://example.test/first?a=1');
  assert.equal(first.get('https://example.test/first?a=1'), 'https://example.test/first');
  await cache.prepare(['https://example.test/' + '界'.repeat(2000), '', 'https://example.test/valid']);
  assert.deepEqual(batches.at(-1), [{ url: 'https://example.test/valid' }]);
});

test('account change drops pending mappings and resolves fresh requests without reviving old aliases', async () => {
  const gate = deferred(); let calls = 0;
  const cache = createBrowserResolutionCache({ resolve: async ({ pages }) => { calls++; if (calls === 1) { await gate.promise; return { pages: pages.map(page => ({ ...page, canonicalPage: 'old:1' })) }; } return response(pages); } });
  const old = cache.prepare(['https://example.test/post?variant=1']); await tick();
  cache.clear(); const fresh = cache.prepare(['https://example.test/post?variant=1']); gate.resolve();
  await Promise.all([old, fresh]);
  assert.equal(cache.canonical('https://example.test/post?variant=1'), 'https://example.test/post');
});

test('more than cache capacity of registered interests remain indexed and removal cleans captured keys', async () => {
  const registry = createContentInterestRegistry({ storageArea: null }); await registry.ready;
  const resolver = createBrowserReferrers(async ({ pages }) => response(pages), () => registry);
  const urls = Array.from({ length: 4200 }, (_, i) => 'https://example.test/post/' + i + '?variant=1');
  await resolver.register({ tabId: 1, frameId: 0, documentId: 'main', sequence: 1, referrerUrls: urls });
  await resolver.register({ tabId: 1, frameId: 2, documentId: 'child', sequence: 1, referrerUrls: ['https://example.test/child?a=1'] });
  const incoming = await resolver.prepare(['https://example.test/post/0?variant=2']);
  assert.deepEqual(registry.matchingTabIds({ referrerUrl: 'https://example.test/post/0?variant=2' }, incoming.canonical('https://example.test/post/0?variant=2')), [1]);
  registry.removeFrame(1, 0, 'main');
  assert.deepEqual(registry.matchingTabIds({}, 'https://example.test/post/0'), []);
  assert.deepEqual(registry.matchingTabIds({}, 'https://example.test/child'), [1]);
  resolver.clear();
  assert.deepEqual(registry.matchingTabIds({}, 'https://example.test/child'), []);
  assert.deepEqual(registry.matchingTabIds({}, 'https://example.test/child?a=1'), [1]);
});

test('late provider responses cannot resurrect navigated frames or restore mappings after account changes', async () => {
  for (const action of ['navigate', 'clear']) {
    const gate = deferred();
    const registry = createContentInterestRegistry({ storageArea: null }); await registry.ready;
    const resolver = createBrowserReferrers(async ({ pages }) => { await gate.promise; return response(pages); }, () => registry);
    const pending = resolver.register({ tabId: 1, documentId: 'old', sequence: 1, referrerUrls: ['https://example.test/post?v=1'], referrerKeys: ['forged:key'] });
    await tick();
    if (action === 'navigate') registry.removeFrame(1, 0, 'old'); else resolver.clear();
    gate.resolve(); const result = await pending;
    assert.equal(result.accepted, false);
    assert.deepEqual(registry.matchingTabIds({}, 'forged:key'), []);
    assert.deepEqual(registry.matchingTabIds({}, 'https://example.test/post'), []);
    if (action === 'navigate') assert.equal(registry.snapshot().length, 0);
  }
});

test('a newer frame interest sequence cannot be overwritten by an older response', async () => {
  const gates = new Map(); const registry = createContentInterestRegistry({ storageArea: null }); await registry.ready;
  const resolver = createBrowserReferrers(async ({ pages }) => { const gate = deferred(); gates.set(pages[0].url, gate); await gate.promise; return response(pages); }, () => registry);
  const first = resolver.register({ tabId: 1, documentId: 'doc', sequence: 1, referrerUrls: ['https://example.test/old?v=1'] }); await tick();
  const second = resolver.register({ tabId: 1, documentId: 'doc', sequence: 2, referrerUrls: ['https://example.test/new?v=1'] });
  gates.get('https://example.test/old?v=1').resolve(); await first; await tick();
  gates.get('https://example.test/new?v=1').resolve(); await second;
  assert.deepEqual(registry.matchingTabIds({}, 'https://example.test/old'), []);
  assert.deepEqual(registry.matchingTabIds({}, 'https://example.test/new'), [1]);
});

test('progress delivery retains only the latest pending event per asset with bounded active work', async () => {
  const gate = deferred(); const delivered = [];
  const relay = createCoalescedDownloadRelay({ limit: 1, deliver: async payload => { delivered.push(payload.progress); if (delivered.length === 1) await gate.promise; } });
  for (let i = 0; i < 1000; i++) assert.equal(relay.submit({ assetUrl: 'https://example.test/asset', progress: i }), true);
  assert.equal(relay.submit({ assetUrl: 'https://example.test/other' }), false);
  assert.deepEqual(delivered, [0]); gate.resolve(); await tick();
  assert.deepEqual(delivered, [0, 999]);
  const secondGate = deferred(); const cleared = [];
  const cancellable = createCoalescedDownloadRelay({ deliver: async payload => { cleared.push(payload.progress); await secondGate.promise; } });
  cancellable.submit({ assetUrl: 'https://example.test/asset', progress: 1 });
  cancellable.submit({ assetUrl: 'https://example.test/asset', progress: 2 });
  cancellable.clear(); secondGate.resolve(); await tick(); assert.deepEqual(cleared, [1]);
});

test('lookup capacity applies backpressure without dropping canonical results', async () => {
  const calls = [];
  const cache = createBrowserResolutionCache({ limit: 2, resolve: async ({ pages }) => { calls.push(pages.length); return response(pages); } });
  const urls = Array.from({ length: 30 }, (_, i) => 'https://example.test/' + i + '?v=1');
  const mappings = await cache.prepare(urls);
  assert.equal(mappings.size, 30); assert.ok(calls.every(size => size <= 2));
  for (const url of urls) assert.equal(mappings.get(url), url.split('?')[0]);
});
