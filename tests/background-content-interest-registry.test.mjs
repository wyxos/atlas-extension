import assert from 'node:assert/strict';
import test from 'node:test';

import { createContentInterestRegistry } from '../src/background/content-interest-registry.js';

test('deferred hard resync survives routine navigation, registration, and stale delivery acknowledgements', async () => {
  const registry = createContentInterestRegistry({ storageArea: null });
  await registry.ready;
  registry.register({ tabId: 1, documentId: 'document', sequence: 1 });
  registry.updateLifecycle(1, { status: 'loading' });
  registry.markNeedsResync(1, true);
  const earlierDelivery = registry.resyncToken(1);
  registry.markNeedsResync(1);
  assert.equal(registry.targetState(1).providerChanged, true);
  assert.equal(registry.updateLifecycle(1, { status: 'complete' }).shouldResync, true);
  const report = registry.register({ tabId: 1, documentId: 'document', sequence: 2 });
  assert.equal(report.providerChanged, true);
  assert.equal(report.resyncRequired, true);
  registry.markNeedsResync(1, true);
  assert.equal(registry.markResynced(1, earlierDelivery), false);
  assert.equal(registry.targetState(1).providerChanged, true);
  registry.markResynced(1, registry.resyncToken(1));
  assert.equal(registry.targetState(1).needsResync, false);
  assert.equal(registry.targetState(1).providerChanged, undefined);
});

for (const tabCount of [1, 100, 300, 700]) {
  test(`routes a download only to exact interested content across ${tabCount} tabs`, async () => {
    const registry = createContentInterestRegistry({ storageArea: null });
    await registry.ready;

    const expected = [];
    for (let index = 1; index <= tabCount; index += 1) {
      const matches = index === 1 || index % 100 === 0;
      if (matches) expected.push(index);
      registry.register({
        documentId: `document-${index}`,
        pageUrl: `https://example.test/posts/${index}`,
        referrerUrls: [`https://example.test/posts/${index}`],
        sequence: 1,
        sourceUrls: [matches
          ? 'https://cdn.example.test/target.jpg'
          : `https://cdn.example.test/${index}.jpg`],
        tabId: index,
      });
    }

    assert.deepEqual(registry.matchingTabIds({
      assetUrl: 'https://cdn.example.test/target.jpg',
    }), expected);
    assert.equal(registry.snapshot().length, tabCount);
  });
}

test('matches referrer-only content while excluding unrelated loaded tabs', async () => {
  const registry = createContentInterestRegistry({ storageArea: null });
  await registry.ready;
  registry.register({
    documentId: 'document-1',
    referrerUrls: ['https://example.test/post/1'],
    sourceUrls: [],
    tabId: 1,
  });
  registry.register({
    documentId: 'document-2',
    referrerUrls: ['https://example.test/post/2'],
    sourceUrls: ['https://cdn.example.test/unrelated.jpg'],
    tabId: 2,
  });

  assert.deepEqual(registry.matchingTabIds({
    referrerUrl: 'https://example.test/post/1',
  }), [1]);
});

test('frozen tabs retain interests and request a targeted resync when resumed', async () => {
  const registry = createContentInterestRegistry({ storageArea: null });
  await registry.ready;
  registry.register({
    documentId: 'document-1',
    sourceUrls: ['https://cdn.example.test/target.jpg'],
    tabId: 1,
  });

  assert.deepEqual(registry.updateLifecycle(1, { frozen: true }), { shouldResync: false });
  assert.deepEqual(registry.matchingTabIds({
    assetUrl: 'https://cdn.example.test/target.jpg',
  }), [1]);
  assert.deepEqual(registry.targetState(1), {
    discarded: false,
    frozen: true,
    loading: false,
    needsResync: true,
  });
  assert.deepEqual(registry.updateLifecycle(1, { frozen: false }), { shouldResync: true });
});

test('discarded tabs replace stale interests when the restored document registers', async () => {
  const registry = createContentInterestRegistry({ storageArea: null });
  await registry.ready;
  registry.register({
    documentId: 'old-document',
    sourceUrls: ['https://cdn.example.test/old.jpg'],
    tabId: 1,
  });
  registry.updateLifecycle(1, { discarded: true });

  const result = registry.register({
    documentId: 'restored-document',
    sourceUrls: ['https://cdn.example.test/restored.jpg'],
    tabId: 1,
  });

  assert.deepEqual(result, { accepted: true, resyncRequired: true });
  assert.deepEqual(registry.matchingTabIds({
    assetUrl: 'https://cdn.example.test/old.jpg',
  }), []);
  assert.deepEqual(registry.matchingTabIds({
    assetUrl: 'https://cdn.example.test/restored.jpg',
  }), [1]);
});

test('replacement and removal clean reverse indexes without affecting sibling interests', async () => {
  const registry = createContentInterestRegistry({ storageArea: null });
  await registry.ready;
  for (const tabId of [1, 2]) {
    registry.register({
      documentId: `document-${tabId}`,
      referrerUrls: ['https://example.test/shared'],
      sourceUrls: ['https://cdn.example.test/shared.jpg'],
      tabId,
    });
  }
  registry.register({
    documentId: 'document-1',
    sequence: 2,
    sourceUrls: ['https://cdn.example.test/replaced.jpg'],
    tabId: 1,
  });

  assert.deepEqual(registry.matchingTabIds({
    assetUrl: 'https://cdn.example.test/shared.jpg',
  }), [2]);
  registry.remove(2);
  assert.deepEqual(registry.matchingTabIds({
    referrerUrl: 'https://example.test/shared',
  }), []);
  assert.deepEqual(registry.matchingTabIds({
    assetUrl: 'https://cdn.example.test/replaced.jpg',
  }), [1]);
});

test('compact interests survive a background worker restart through session storage', async () => {
  const values = {};
  const storageArea = {
    async get(key) { return { [key]: clone(values[key]) }; },
    async set(next) { Object.assign(values, clone(next)); },
  };
  const first = createContentInterestRegistry({ storageArea });
  await first.ready;
  first.register({
    documentId: 'document-1',
    referrerUrls: ['https://example.test/post/1'],
    sequence: 3,
    sourceUrls: ['https://cdn.example.test/target.jpg'],
    tabId: 11,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const restored = createContentInterestRegistry({ storageArea });
  await restored.ready;

  assert.deepEqual(restored.matchingTabIds({
    assetUrl: 'https://cdn.example.test/target.jpg',
  }), [11]);
  assert.equal(restored.snapshot()[0].sequence, 3);
});

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

test('iframe interests coexist, survive restart, and retire by document without removing siblings', async () => {
  const values = {};
  const storageArea = {
    async get() { return clone(values); },
    async set(next) { Object.assign(values, clone(next)); },
  };
  const registry = createContentInterestRegistry({ storageArea });
  await registry.ready;
  const shared = 'https://example.test/shared.mp4';
  for (const frameId of [0, 4, 7]) registry.register({
    tabId: 1, frameId, documentId: `doc-${frameId}`, sequence: 2,
    sourceUrls: [shared, `https://example.test/${frameId}.mp4`],
  });
  registry.register({ tabId: 1, frameId: 4, documentId: 'doc-4', sequence: 1, sourceUrls: [] });
  assert.deepEqual(registry.matchingTabIds({ assetUrl: 'https://example.test/4.mp4' }), [1]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const restored = createContentInterestRegistry({ storageArea });
  await restored.ready;
  assert.equal(restored.snapshot()[0].frames.length, 3);
  restored.register({ tabId: 1, frameId: 4, documentId: 'replacement', sourceUrls: [] });
  assert.equal(restored.removeFrame(1, 4, 'doc-4'), false);
  assert.deepEqual(restored.matchingTabIds({ assetUrl: 'https://example.test/4.mp4' }), []);
  assert.deepEqual(restored.matchingTabIds({ assetUrl: 'https://example.test/7.mp4' }), [1]);
  restored.removeFrame(1, 7);
  assert.deepEqual(restored.matchingTabIds({ assetUrl: shared }), [1]);
  restored.remove(1);
  assert.deepEqual(restored.matchingTabIds({ assetUrl: shared }), []);
});
