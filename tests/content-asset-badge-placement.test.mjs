import assert from 'node:assert/strict';
import test from 'node:test';

import { placeVisibleAssetBadge } from '../src/content/asset-badge-placement.js';

test('removes direct badge hosts instead of placing widgets for hidden assets', () => {
  const calls = [];
  const placement = placeVisibleAssetBadge({
    asset: { type: 'image' },
    badgeHosts: {
      placeBadge() {
        throw new Error('hidden assets should not place badge hosts');
      },
      remove: (id) => calls.push(['remove', id]),
    },
    element: {},
    id: 'asset-1',
    viewportPadding: 4,
    visibleRect: null,
  });

  assert.deepEqual(placement, {});
  assert.deepEqual(calls, [['remove', 'asset-1']]);
});

test('places direct badge hosts only when an asset has a visible rect', () => {
  const placement = { badgeStyle: { display: 'flex' }, portalTarget: {} };
  const calls = [];
  const result = placeVisibleAssetBadge({
    asset: { type: 'image' },
    badgeHosts: {
      placeBadge: (id, element, asset, options) => {
        calls.push({ asset, element, id, options });

        return placement;
      },
      remove() {
        throw new Error('visible assets should not remove badge hosts');
      },
    },
    element: { id: 'image' },
    id: 'asset-1',
    viewportPadding: 4,
    visibleRect: {
      bottom: 100,
      left: 20,
      width: 320,
    },
  });

  assert.equal(result, placement);
  assert.deepEqual(calls, [{
    asset: { type: 'image' },
    element: { id: 'image' },
    id: 'asset-1',
    options: {
      variant: 'asset',
      viewportPadding: 4,
    },
  }]);
});
