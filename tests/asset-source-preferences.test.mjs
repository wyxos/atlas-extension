import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addAssetSourceDomain,
  assetSourcePreferencesKey,
  createDefaultAssetSourcePreferences,
  filterAssetSourceDomains,
  imageSourcePreferenceValues,
  loadAssetSourcePreferences,
  removeAssetSourceDomain,
  resolveAssetImageSourcePreference,
  setAssetImageSourcePreference,
} from '../src/shared/asset-source-preferences.js';
import * as assetSourcePreferences from '../src/shared/asset-source-preferences.js';

const defaultMatching = {
  cleanup: {
    query: {
      mode: 'none',
      params: [],
    },
    removeFragment: false,
  },
  matchBy: 'source',
  ruleId: '',
};

test('defaults to an empty asset source domain list', async () => {
  const storage = createStorage();

  assert.deepEqual(createDefaultAssetSourcePreferences(), {
    domains: [],
    profiles: [],
    version: 3,
  });

  assert.deepEqual(await loadAssetSourcePreferences(storage), {
    domains: [],
    profiles: [],
    version: 3,
  });
});

test('adds normalized asset source profile domains without duplicates', async () => {
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
    profiles: [
      {
        asset: {
          imageSourcePreference: imageSourcePreferenceValues.highestSrcset,
          matching: defaultMatching,
        },
        domain: 'reddit.com',
        referrer: {
          rules: [],
        },
      },
      {
        asset: {
          imageSourcePreference: imageSourcePreferenceValues.src,
          matching: defaultMatching,
        },
        domain: 'x.com',
        referrer: {
          rules: [],
        },
      },
    ],
    version: 3,
  });
});

test('removes normalized asset source profile domains', async () => {
  const storage = createStorage({
    [assetSourcePreferencesKey]: {
      domains: ['reddit.com', 'x.com'],
      version: 1,
    },
  });

  await removeAssetSourceDomain('https://www.reddit.com/comments/123', storage);

  assert.deepEqual(await loadAssetSourcePreferences(storage), {
    domains: ['x.com'],
    profiles: [
      {
        asset: {
          imageSourcePreference: imageSourcePreferenceValues.src,
          matching: defaultMatching,
        },
        domain: 'x.com',
        referrer: {
          rules: [],
        },
      },
    ],
    version: 3,
  });
});

test('stores per-profile image source preferences', async () => {
  const storage = createStorage();

  await addAssetSourceDomain('reddit.com', storage);
  assert.equal(
    resolveAssetImageSourcePreference(await loadAssetSourcePreferences(storage), 'https://www.reddit.com/r/art'),
    imageSourcePreferenceValues.highestSrcset,
  );

  await setAssetImageSourcePreference('reddit.com', imageSourcePreferenceValues.src, storage);
  assert.equal(
    resolveAssetImageSourcePreference(await loadAssetSourcePreferences(storage), 'reddit.com'),
    imageSourcePreferenceValues.src,
  );
});

test('normalizes profile-only stored preferences into domains', async () => {
  const storage = createStorage({
    [assetSourcePreferencesKey]: {
      profiles: [
        {
          asset: {
            imageSourcePreference: imageSourcePreferenceValues.highestSrcset,
          },
          domain: 'reddit.com',
        },
      ],
      version: 2,
    },
  });

  assert.deepEqual(await loadAssetSourcePreferences(storage), {
    domains: ['reddit.com'],
    profiles: [
      {
        asset: {
          imageSourcePreference: imageSourcePreferenceValues.highestSrcset,
          matching: defaultMatching,
        },
        domain: 'reddit.com',
        referrer: {
          rules: [],
        },
      },
    ],
    version: 3,
  });
});

test('normalizes profile matching defaults and structured cleanup rules', async () => {
  const storage = createStorage({
    [assetSourcePreferencesKey]: {
      domains: ['facebook.com', 'media.example.test', 'x.com'],
      profiles: [
        {
          asset: {
            matching: {
              cleanup: {
                query: {
                  mode: 'keep-selected',
                  params: ['fbid', 'set', 'fbid'],
                },
                removeFragment: true,
              },
              matchBy: 'referrer',
              ruleId: 'facebook-photo',
            },
          },
          domain: 'facebook.com',
        },
        {
          asset: {
            matching: {
              cleanup: {
                query: {
                  mode: 'strip-selected',
                  params: ['utm_source', ''],
                },
              },
              matchBy: 'source',
            },
          },
          domain: 'media.example.test',
        },
        {
          asset: {
            matching: {
              cleanup: {
                query: {
                  mode: 'regex',
                  params: ['ignored'],
                },
              },
              matchBy: 'unsupported',
            },
          },
          domain: 'x.com',
        },
      ],
      version: 2,
    },
  });

  assert.deepEqual((await loadAssetSourcePreferences(storage)).profiles.map((profile) => ({
    domain: profile.domain,
    matching: profile.asset.matching,
  })), [
    {
      domain: 'facebook.com',
      matching: {
        cleanup: {
          query: {
            mode: 'keep-selected',
            params: ['fbid', 'set'],
          },
          removeFragment: true,
        },
        matchBy: 'referrer',
        ruleId: 'facebook-photo',
      },
    },
    {
      domain: 'media.example.test',
      matching: {
        cleanup: {
          query: {
            mode: 'strip-selected',
            params: ['utm_source'],
          },
          removeFragment: false,
        },
        matchBy: 'source',
        ruleId: '',
      },
    },
    {
      domain: 'x.com',
      matching: defaultMatching,
    },
  ]);
});

test('stores per-profile matching rules without rewriting raw profile domains', async () => {
  const storage = createStorage();

  await addAssetSourceDomain('facebook.com', storage);
  assert.equal(typeof assetSourcePreferences.setAssetMatchingRule, 'function');

  await assetSourcePreferences.setAssetMatchingRule('https://www.facebook.com/photo/123', {
    cleanup: {
      query: {
        mode: 'keep-selected',
        params: ['fbid'],
      },
      removeFragment: true,
    },
    matchBy: 'referrer',
    ruleId: 'facebook-photo',
  }, storage);

  assert.deepEqual((await loadAssetSourcePreferences(storage)).profiles[0], {
    asset: {
      imageSourcePreference: imageSourcePreferenceValues.src,
      matching: {
        cleanup: {
          query: {
            mode: 'keep-selected',
            params: ['fbid'],
          },
          removeFragment: true,
        },
        matchBy: 'referrer',
        ruleId: 'facebook-photo',
      },
    },
    domain: 'facebook.com',
    referrer: {
      rules: [],
    },
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
