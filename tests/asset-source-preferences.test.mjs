import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addAssetSourceDomain,
  assetSourcePreferencesKey,
  createDefaultAssetSourcePreferences,
  filterAssetSourceDomains,
  loadAssetSourcePreferences,
  removeAssetSourceDomain,
} from '../src/shared/asset-source-preferences.js';

test('defaults to an empty asset source domain list', async () => {
  const storage = createStorage();

  assert.deepEqual(createDefaultAssetSourcePreferences(), {
    domains: [],
    version: 1,
  });

  assert.deepEqual(await loadAssetSourcePreferences(storage), {
    domains: [],
    version: 1,
  });
});

test('adds normalized asset source domains without duplicates', async () => {
  const storage = createStorage({
    [assetSourcePreferencesKey]: {
      domains: ['x.com'],
      version: 1,
    },
  });

  await addAssetSourceDomain('https://www.reddit.com/r/StableDiffusion', storage);
  await addAssetSourceDomain('reddit.com', storage);

  assert.deepEqual(await loadAssetSourcePreferences(storage), {
    domains: ['reddit.com', 'x.com'],
    version: 1,
  });
});

test('removes normalized asset source domains', async () => {
  const storage = createStorage({
    [assetSourcePreferencesKey]: {
      domains: ['reddit.com', 'x.com'],
      version: 1,
    },
  });

  await removeAssetSourceDomain('https://www.reddit.com/comments/123', storage);

  assert.deepEqual(await loadAssetSourcePreferences(storage), {
    domains: ['x.com'],
    version: 1,
  });
});

test('filters asset source domains by case-insensitive text', () => {
  const domains = ['deviantart.com', 'reddit.com', 'stable-diffusion.reddit.com'];

  assert.deepEqual(filterAssetSourceDomains(domains, ''), domains);
  assert.deepEqual(filterAssetSourceDomains(domains, 'Reddit'), [
    'reddit.com',
    'stable-diffusion.reddit.com',
  ]);
  assert.deepEqual(filterAssetSourceDomains(domains, 'art'), ['deviantart.com']);
});

function createStorage(initialValues = {}) {
  const values = { ...initialValues };

  return {
    async get(key) {
      return { [key]: values[key] };
    },
    async set(nextValues) {
      Object.assign(values, nextValues);
    },
  };
}
