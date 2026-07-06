import assert from 'node:assert/strict';
import test from 'node:test';

import { createOpenTabRegistry } from '../src/background/tab-state.js';

test('tracks comparable open tab counts by full URL including hash', () => {
  const registry = createOpenTabRegistry();

  registry.replaceTabs([
    { id: 1, url: 'https://example.test/post#one' },
    { id: 2, url: 'https://example.test/post#one' },
    { id: 3, url: 'https://example.test/post#two' },
    { id: 4, url: 'https://example.test/' },
  ]);

  assert.deepEqual(registry.getCounts(), {
    'https://example.test/post#one': 2,
    'https://example.test/post#two': 1,
  });
});

test('updates tab counts and reports affected URLs', () => {
  const registry = createOpenTabRegistry();

  registry.replaceTabs([
    { id: 1, url: 'https://example.test/post#one' },
    { id: 2, url: 'https://example.test/post#one' },
  ]);

  assert.deepEqual(
    registry.updateTab(2, 'https://example.test/post#two'),
    [
      'https://example.test/post#one',
      'https://example.test/post#two',
    ],
  );
  assert.deepEqual(registry.getCounts(), {
    'https://example.test/post#one': 1,
    'https://example.test/post#two': 1,
  });

  assert.deepEqual(registry.removeTab(1), ['https://example.test/post#one']);
  assert.deepEqual(registry.getCounts(), {
    'https://example.test/post#two': 1,
  });
});

test('tracks same-domain tab counts against total tabs per window', () => {
  const registry = createOpenTabRegistry();

  registry.replaceTabs([
    { id: 1, url: 'https://www.example.test/post/one', windowId: 10 },
    { id: 2, url: 'https://example.test/post/two', windowId: 10 },
    { id: 3, url: 'https://other.test/post', windowId: 10 },
    { id: 4, url: 'chrome://extensions/', windowId: 10 },
    { id: 5, url: 'https://example.test/post/three', windowId: 11 },
  ]);

  assert.deepEqual(registry.getTabCounter(1), {
    domain: 'example.test',
    sameDomainTabs: 2,
    totalTabsInWindow: 4,
  });
  assert.deepEqual(registry.getTabCounter(3), {
    domain: 'other.test',
    sameDomainTabs: 1,
    totalTabsInWindow: 4,
  });
  assert.equal(registry.getTabCounter(4), null);
  assert.deepEqual(registry.getWindowTabIds(10), [1, 2, 3, 4]);
});

test('updates same-domain tab counts when tabs move and close', () => {
  const registry = createOpenTabRegistry();

  registry.replaceTabs([
    { id: 1, url: 'https://example.test/post/one', windowId: 10 },
    { id: 2, url: 'https://other.test/post/two', windowId: 10 },
    { id: 3, url: 'https://example.test/post/three', windowId: 11 },
  ]);

  registry.updateTab(2, 'https://www.example.test/post/two', { windowId: 10 });

  assert.deepEqual(registry.getTabCounter(1), {
    domain: 'example.test',
    sameDomainTabs: 2,
    totalTabsInWindow: 2,
  });

  registry.moveTab(3, 10);

  assert.deepEqual(registry.getTabCounter(1), {
    domain: 'example.test',
    sameDomainTabs: 3,
    totalTabsInWindow: 3,
  });

  registry.removeTab(2);

  assert.deepEqual(registry.getTabCounter(1), {
    domain: 'example.test',
    sameDomainTabs: 2,
    totalTabsInWindow: 2,
  });
});
