import assert from 'node:assert/strict';
import test from 'node:test';

import { assetSourceLabel, listReactionSheetAssets } from '../src/content/asset-sheet-model.js';

test('lists only unique direct badges that are rendered by the reaction overlay', () => {
  const firstAsset = {
    id: 'asset-1',
    source: 'https://cdn.example.test/art.jpg',
  };
  const secondAsset = {
    id: 'asset-2',
    source: 'https://cdn.example.test/video.mp4',
  };

  assert.deepEqual(listReactionSheetAssets([
    firstAsset,
    {
      id: 'asset-duplicate',
      source: firstAsset.source,
    },
    {
      id: 'referrer-1',
      source: 'https://cdn.example.test/linked.jpg',
      variant: 'referrer',
    },
    secondAsset,
  ]), [firstAsset, secondAsset]);
});

test('keeps query parameters visible in recognized asset labels', () => {
  assert.equal(
    assetSourceLabel('https://www.youtube.com/watch?v=ariZ13hVPb4'),
    'www.youtube.com/watch?v=ariZ13hVPb4',
  );
});
