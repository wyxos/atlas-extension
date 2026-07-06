import assert from 'node:assert/strict';
import test from 'node:test';

import {
  reactionWidgetVisibilityStorageKey,
  readReactionWidgetVisibility,
  toggleReactionWidgetVisibility,
} from '../src/shared/reaction-widget-visibility.js';

test('reaction widget visibility defaults to shown', async () => {
  const storageArea = {
    get(key, callback) {
      callback({ [key]: undefined });
    },
  };

  assert.equal(await readReactionWidgetVisibility({ storageArea }), true);
});

test('reaction widget visibility toggle persists the next state', async () => {
  const calls = [];
  let stored = false;
  const storageArea = {
    get(key, callback) {
      calls.push(['get', key]);
      callback({ [key]: stored });
    },
    set(values, callback) {
      calls.push(['set', values]);
      stored = values[reactionWidgetVisibilityStorageKey];
      callback();
    },
  };

  const visible = await toggleReactionWidgetVisibility({ storageArea });

  assert.equal(visible, true);
  assert.deepEqual(calls, [
    ['get', reactionWidgetVisibilityStorageKey],
    ['set', { [reactionWidgetVisibilityStorageKey]: true }],
  ]);
});
