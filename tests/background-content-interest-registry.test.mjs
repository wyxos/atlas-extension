import assert from 'node:assert/strict';
import test from 'node:test';

import { createContentInterestRegistry } from '../src/background/content-interest-registry.js';

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
