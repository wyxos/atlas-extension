import assert from 'node:assert/strict';
import test from 'node:test';

import {
  batchProviderPreferencesKey,
  loadBatchProviderPreferences,
  saveBatchProviderPreference,
} from '../src/content/batch-provider-preferences.js';

test('loads and normalizes batch provider preferences', async () => {
  const preferences = await loadBatchProviderPreferences({
    async get(key) {
      assert.equal(key, batchProviderPreferencesKey);

      return {
        [batchProviderPreferencesKey]: {
          deviantart: true,
          empty: false,
          invalid: 'yes',
        },
      };
    },
  });

  assert.deepEqual(preferences, {
    deviantart: true,
  });
});

test('saves batch provider preferences under one global extension key', async () => {
  const writes = [];
  const storage = {
    async get() {
      return {
        [batchProviderPreferencesKey]: {
          deviantart: true,
        },
      };
    },
    async set(value) {
      writes.push(value);
    },
  };

  await saveBatchProviderPreference('deviantart', false, storage);
  await saveBatchProviderPreference('twitter', true, storage);

  assert.deepEqual(writes, [
    {
      [batchProviderPreferencesKey]: {},
    },
    {
      [batchProviderPreferencesKey]: {
        deviantart: true,
        twitter: true,
      },
    },
  ]);
});
