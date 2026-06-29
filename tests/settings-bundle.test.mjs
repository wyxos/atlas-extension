import assert from 'node:assert/strict';
import test from 'node:test';

import { assetSourcePreferencesKey } from '../src/shared/asset-source-preferences.js';
import { batchProviderPreferencesKey } from '../src/content/batch-provider-preferences.js';
import { closeTabPreferencesKey } from '../src/shared/close-tab-preferences.js';
import { storageKey } from '../src/options/connection.js';
import {
  applySettingsBundle,
  buildSettingsBundle,
  createRemoteSettingsBundle,
  mergeSettingsBundles,
  summarizeSettingsBundleDifferences,
  settingsBundleSchemaVersion,
} from '../src/shared/settings-bundle.js';

test('builds an exportable settings bundle from all extension settings stores', async () => {
  const storage = createStorage({
    [assetSourcePreferencesKey]: {
      domains: ['reddit.com'],
      profiles: [
        {
          asset: {
            imageSourcePreference: 'srcset-highest',
          },
          domain: 'reddit.com',
        },
      ],
      version: 2,
    },
    [batchProviderPreferencesKey]: {
      deviantart: true,
      empty: false,
    },
    [closeTabPreferencesKey]: {
      modesBySiteDomain: {
        'reddit.com': 'after_queue',
      },
      version: 1,
    },
    [storageKey]: {
      mode: 'live',
      profiles: {
        live: {
          apiKey: 'secret-key',
          domain: 'https://atlas.example.test',
          status: 'connected',
        },
        local: {
          status: 'idle',
        },
      },
      version: 2,
    },
  });

  const bundle = await buildSettingsBundle({ storage });

  assert.equal(bundle.schemaVersion, settingsBundleSchemaVersion);
  assert.equal(bundle.settings.connection.profiles.live.apiKey, 'secret-key');
  assert.equal(bundle.settings.connection.profiles.live.domain, 'https://atlas.example.test');
  assert.deepEqual(bundle.settings.assetSourcePreferences.domains, ['reddit.com']);
  assert.deepEqual(bundle.settings.closeTabPreferences.modesBySiteDomain, {
    'reddit.com': 'after_queue',
  });
  assert.deepEqual(bundle.settings.batchProviderPreferences, {
    deviantart: true,
  });
});

test('creates a remote settings bundle without storing the API key', async () => {
  const bundle = await buildSettingsBundle({
    storage: createStorage({
      [storageKey]: {
        mode: 'live',
        profiles: {
          live: {
            apiKey: 'secret-key',
            domain: 'https://atlas.example.test',
            status: 'connected',
          },
          local: {
            status: 'idle',
          },
        },
        version: 2,
      },
    }),
  });

  const remoteBundle = createRemoteSettingsBundle(bundle);

  assert.equal(remoteBundle.settings.connection.profiles.live.domain, 'https://atlas.example.test');
  assert.equal(remoteBundle.settings.connection.profiles.live.apiKey, '');
});

test('applies downloaded settings while preserving the current API key', async () => {
  const storage = createStorage({
    [storageKey]: {
      mode: 'live',
      profiles: {
        live: {
          apiKey: 'current-secret',
          domain: 'https://atlas.example.test',
          status: 'connected',
        },
        local: {
          status: 'idle',
        },
      },
      version: 2,
    },
  });

  await applySettingsBundle({
    schemaVersion: settingsBundleSchemaVersion,
    settings: {
      assetSourcePreferences: {
        domains: ['reddit.com'],
        version: 2,
      },
      batchProviderPreferences: {
        deviantart: true,
      },
      closeTabPreferences: {
        modesBySiteDomain: {
          'reddit.com': 'on_complete',
        },
        version: 1,
      },
      connection: {
        mode: 'live',
        profiles: {
          live: {
            apiKey: '',
            domain: 'https://atlas.example.test',
            status: 'connected',
          },
          local: {
            status: 'idle',
          },
        },
        version: 2,
      },
    },
  }, {
    preserveConnectionSecrets: true,
    storage,
  });

  const values = await storage.get([
    assetSourcePreferencesKey,
    batchProviderPreferencesKey,
    closeTabPreferencesKey,
    storageKey,
  ]);

  assert.equal(values[storageKey].profiles.live.apiKey, 'current-secret');
  assert.deepEqual(values[assetSourcePreferencesKey].domains, ['reddit.com']);
  assert.deepEqual(values[batchProviderPreferencesKey], { deviantart: true });
  assert.deepEqual(values[closeTabPreferencesKey].modesBySiteDomain, {
    'reddit.com': 'on_complete',
  });
});

test('summarizes changed settings bundle sections', () => {
  const differences = summarizeSettingsBundleDifferences(
    createSettingsBundle({ assetDomains: ['reddit.com'] }),
    createSettingsBundle({ assetDomains: ['deviantart.com'] }),
  );

  assert.deepEqual(differences, [
    {
      key: 'assetSourcePreferences',
      label: 'Asset source profiles',
    },
  ]);
});

test('merges local and remote settings while keeping local overlap values', () => {
  const merged = mergeSettingsBundles(
    createSettingsBundle({
      assetDomains: ['reddit.com'],
      batchProviders: {
        reddit: true,
      },
      closeTabModes: {
        'reddit.com': 'after_queue',
      },
      connectionDomain: 'https://local.example.test',
    }),
    createSettingsBundle({
      assetDomains: ['deviantart.com', 'reddit.com'],
      batchProviders: {
        deviantart: true,
      },
      closeTabModes: {
        'reddit.com': 'on_complete',
        'x.com': 'on_complete',
      },
      connectionDomain: 'https://remote.example.test',
    }),
  );

  assert.deepEqual(merged.settings.assetSourcePreferences.domains, [
    'deviantart.com',
    'reddit.com',
  ]);
  assert.deepEqual(merged.settings.batchProviderPreferences, {
    deviantart: true,
    reddit: true,
  });
  assert.deepEqual(merged.settings.closeTabPreferences.modesBySiteDomain, {
    'reddit.com': 'after_queue',
    'x.com': 'on_complete',
  });
  assert.equal(merged.settings.connection.profiles.live.domain, 'https://local.example.test');
});

function createStorage(initialValues = {}) {
  const values = cloneJson(initialValues);

  return {
    async get(key) {
      if (Array.isArray(key)) {
        return Object.fromEntries(key.map((item) => [item, values[item]]));
      }

      return { [key]: values[key] };
    },
    async set(nextValues) {
      Object.assign(values, cloneJson(nextValues));
    },
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function createSettingsBundle({
  assetDomains = [],
  batchProviders = {},
  closeTabModes = {},
  connectionDomain = 'https://atlas.example.test',
} = {}) {
  return {
    schemaVersion: settingsBundleSchemaVersion,
    settings: {
      assetSourcePreferences: {
        domains: assetDomains,
        version: 2,
      },
      batchProviderPreferences: batchProviders,
      closeTabPreferences: {
        modesBySiteDomain: closeTabModes,
        version: 1,
      },
      connection: {
        mode: 'live',
        profiles: {
          live: {
            apiKey: '',
            domain: connectionDomain,
            status: 'connected',
          },
          local: {
            status: 'idle',
          },
        },
        version: 2,
      },
    },
  };
}
