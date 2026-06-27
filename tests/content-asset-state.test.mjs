import assert from 'node:assert/strict';
import test from 'node:test';

import {
  stateWithoutAtlasAssetStatus,
  stateForSyncedAsset,
  shouldApplyAssetResponse,
} from '../src/content/asset-state.js';

test('clearing missing Atlas asset status preserves local batch state', () => {
  assert.deepEqual(stateWithoutAtlasAssetStatus({
    batch: {
      available: true,
      checked: true,
    },
    download: {
      downloaded_at: '2026-06-25T12:00:00Z',
      status: 'completed',
    },
    file: {
      atlas_url: 'https://atlas.test/browse/file/123',
      id: 123,
    },
    reaction: { type: 'love' },
  }), {
    batch: {
      available: true,
      checked: true,
    },
  });
});

test('resets badge state when a reused asset element changes source', () => {
  const currentState = {
    download: {
      downloaded_at: '2026-06-25T12:00:00Z',
      status: 'completed',
    },
    reaction: { type: 'like' },
  };

  assert.equal(
    stateForSyncedAsset(
      { source: 'https://www.facebook.com/reel/982079264798911', type: 'video' },
      { source: 'https://www.facebook.com/reel/next', type: 'video' },
      currentState,
    ),
    null,
  );

  assert.equal(
    stateForSyncedAsset(
      { source: 'https://www.facebook.com/reel/982079264798911', type: 'video' },
      { source: 'https://www.facebook.com/reel/982079264798911', type: 'video' },
      currentState,
    ),
    currentState,
  );
});

test('ignores async responses for asset elements recycled to another source', () => {
  const reactedAsset = { source: 'https://www.facebook.com/reel/982079264798911', type: 'video' };

  assert.equal(
    shouldApplyAssetResponse(reactedAsset, { source: 'https://www.facebook.com/reel/next', type: 'video' }),
    false,
  );

  assert.equal(
    shouldApplyAssetResponse(reactedAsset, { source: 'https://www.facebook.com/reel/982079264798911', type: 'video' }),
    true,
  );

  assert.equal(shouldApplyAssetResponse(reactedAsset, undefined), false);
});
