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
