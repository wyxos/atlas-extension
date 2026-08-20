import assert from 'node:assert/strict';
import test from 'node:test';

import { createWidgetPlacementRuntime } from '../src/content/widget-placement-runtime.js';
import { overlayPlacementPreferencesKey } from '../src/shared/overlay-placement-preferences.js';

function storageWith(preferences) {
  globalThis.chrome = {
    storage: {
      local: {
        async get() { return { [overlayPlacementPreferencesKey]: preferences }; },
      },
    },
  };
}

test('dragging applies a clamped domain placement immediately and persists only on commit', async (t) => {
  t.after(() => { delete globalThis.chrome; });
  storageWith({ positionsBySiteDomain: {}, version: 1 });
  const saved = [];
  let refreshes = 0;
  const runtime = createWidgetPlacementRuntime({
    getElement: () => ({
      getBoundingClientRect: () => ({ height: 100, left: 10, top: 20, width: 200 }),
    }),
    getLocationHref: () => 'https://www.example.com/post/1',
    refresh: () => { refreshes += 1; },
    reportFailure: assert.fail,
    savePlacement: async (value) => { saved.push(value); },
  });
  await runtime.initialize();

  await runtime.change({ clientX: 500, clientY: -20, commit: false, id: 'asset-1' });
  assert.deepEqual(runtime.placementForCurrentSite(), { xRatio: 1, yRatio: 0 });
  assert.equal(saved.length, 0);

  await runtime.change({ commit: true, deltaXRatio: -0.25, deltaYRatio: 0.5, id: 'asset-1' });
  assert.deepEqual(saved, [{
    placement: { xRatio: 0.75, yRatio: 0.5 },
    siteDomain: 'example.com',
  }]);
  assert.ok(refreshes >= 3);
});

test('placements remain domain-isolated and revert to Desktop policy when persistence fails', async (t) => {
  t.after(() => { delete globalThis.chrome; });
  storageWith({
    positionsBySiteDomain: {
      'example.com': { xRatio: 0.2, yRatio: 0.3 },
      'other.test': { xRatio: 0.8, yRatio: 0.7 },
    },
    version: 1,
  });
  const failures = [];
  const runtime = createWidgetPlacementRuntime({
    getElement: () => ({ getBoundingClientRect: () => ({ height: 100, left: 0, top: 0, width: 100 }) }),
    getLocationHref: () => 'https://example.com/media',
    refresh: () => {},
    reportFailure: (id, message) => failures.push([id, message]),
    savePlacement: async () => { throw new Error('Desktop rejected placement'); },
  });
  await runtime.initialize();
  assert.deepEqual(runtime.placementForCurrentSite(), { xRatio: 0.2, yRatio: 0.3 });

  await runtime.change({ commit: true, deltaXRatio: 0.1, deltaYRatio: 0.1, id: 'asset-2' });
  assert.deepEqual(runtime.placementForCurrentSite(), { xRatio: 0.2, yRatio: 0.3 });
  assert.deepEqual(failures, [['asset-2', 'Desktop rejected placement']]);
});
