import assert from 'node:assert/strict';
import test from 'node:test';

import { createCloseTabModeState } from '../src/content/close-tab-mode-state.js';
import { closeTabModes, closeTabPreferencesKey } from '../src/shared/close-tab-preferences.js';

test('updates active tab close mode from storage changes for the current site domain', async () => {
  const listeners = [];
  const changedModes = [];
  const storage = {
    async get() {
      return {
        [closeTabPreferencesKey]: {
          modesBySiteDomain: {},
          version: 1,
        },
      };
    },
    async set() {},
  };
  const state = createCloseTabModeState({
    getLocationHref: () => 'https://www.x.com/user/status/123',
    onChanged() {
      changedModes.push(state.presentationState().mode);
    },
    onStorageChanged: {
      addListener(listener) {
        listeners.push(listener);
      },
    },
    storage,
  });

  await state.initialize();
  changedModes.length = 0;
  listeners[0]({
    [closeTabPreferencesKey]: {
      newValue: {
        modesBySiteDomain: {
          'x.com': closeTabModes.afterQueue,
        },
        version: 1,
      },
    },
  }, 'local');

  assert.deepEqual(changedModes, [closeTabModes.afterQueue]);
  assert.deepEqual(state.presentationState(), {
    available: true,
    mode: closeTabModes.afterQueue,
  });
});

test('ignores close mode storage changes for other site domains', async () => {
  const listeners = [];
  let updateCount = 0;
  const state = createCloseTabModeState({
    getLocationHref: () => 'https://www.youtube.com/watch?v=1',
    onChanged() {
      updateCount += 1;
    },
    onStorageChanged: {
      addListener(listener) {
        listeners.push(listener);
      },
    },
    storage: {
      async get() {
        return {
          [closeTabPreferencesKey]: {
            modesBySiteDomain: {},
            version: 1,
          },
        };
      },
      async set() {},
    },
  });

  await state.initialize();
  updateCount = 0;
  listeners[0]({
    [closeTabPreferencesKey]: {
      newValue: {
        modesBySiteDomain: {
          'x.com': closeTabModes.onComplete,
        },
        version: 1,
      },
    },
  }, 'local');

  assert.equal(updateCount, 0);
  assert.equal(state.presentationState().mode, closeTabModes.off);
});
