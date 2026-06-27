import assert from 'node:assert/strict';
import test from 'node:test';

import { upsertBadgeEntry } from '../src/content/overlay-state.js';

test('badge upserts replace stale optional fields', () => {
  const portalTarget = { id: 'old-target' };
  const badges = [];

  upsertBadgeEntry(badges, 'asset-1', {
    portalTarget,
    progressPercent: 100,
    source: 'https://cdn.example.test/file.jpg',
  });
  upsertBadgeEntry(badges, 'asset-1', {
    progressPercent: 0,
    source: 'https://cdn.example.test/file.jpg',
  });

  assert.deepEqual(badges, [{
    id: 'asset-1',
    progressPercent: 0,
    source: 'https://cdn.example.test/file.jpg',
  }]);
});
