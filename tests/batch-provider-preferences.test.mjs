import assert from 'node:assert/strict';
import test from 'node:test';

import {
  batchProviderPreferencesKey,
  bindBatchProviderPreferences,
} from '../src/content/batch-provider-preferences.js';

test('binds batch provider storage changes for already-open tabs', async () => {
  const listeners = [];
  const appliedPreferences = [];
  const storage = {
    async get() {
      return {
        [batchProviderPreferencesKey]: {
          deviantart: true,
        },
      };
    },
  };

  bindBatchProviderPreferences({
    applyPreferences(preferences) {
      appliedPreferences.push(preferences);
    },
    onChanged: {
      addListener(listener) {
        listeners.push(listener);
      },
    },
    storage,
  });

  while (appliedPreferences.length === 0) {
    await Promise.resolve();
  }

  listeners[0]({
    [batchProviderPreferencesKey]: {
      newValue: {
        deviantart: false,
        youtube: true,
      },
    },
  }, 'local');

  assert.deepEqual(appliedPreferences, [
    { deviantart: true },
    { youtube: true },
  ]);
});
