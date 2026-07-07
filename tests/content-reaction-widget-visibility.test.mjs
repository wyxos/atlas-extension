import assert from 'node:assert/strict';
import test from 'node:test';

import { initializeReactionWidgetVisibility } from '../src/content/reaction-widget-visibility.js';
import { reactionWidgetVisibilityStorageKey } from '../src/shared/reaction-widget-visibility.js';

test('hidden reaction widget state hides badge surfaces without hiding the dialog host', async () => {
  const previousChrome = globalThis.chrome;
  const badgeVisibility = [];
  const overlayBadgeVisibility = [];
  const overlayHost = { style: { display: '' } };
  const storageListeners = [];
  let shownCount = 0;

  globalThis.chrome = {
    storage: {
      local: {
        get(key, callback) {
          callback({ [key]: false });
        },
      },
      onChanged: {
        addListener(listener) {
          storageListeners.push(listener);
        },
        removeListener() {},
      },
    },
  };

  try {
    await initializeReactionWidgetVisibility({
      badgeHosts: {
        setVisible(visible) {
          badgeVisibility.push(visible);
        },
      },
      getOverlayHost: () => overlayHost,
      onShown: () => {
        shownCount += 1;
      },
      setOverlayBadgesVisible(visible) {
        overlayBadgeVisibility.push(visible);
      },
    });

    assert.deepEqual(badgeVisibility, [false]);
    assert.deepEqual(overlayBadgeVisibility, [false]);
    assert.equal(overlayHost.style.display, '');
    assert.equal(shownCount, 0);

    storageListeners[0]?.({
      [reactionWidgetVisibilityStorageKey]: { newValue: true },
    }, 'local');

    assert.deepEqual(badgeVisibility, [false, true]);
    assert.deepEqual(overlayBadgeVisibility, [false, true]);
    assert.equal(overlayHost.style.display, '');
    assert.equal(shownCount, 0);
  } finally {
    if (previousChrome === undefined) {
      delete globalThis.chrome;
    } else {
      globalThis.chrome = previousChrome;
    }
  }
});
