import assert from 'node:assert/strict';
import test from 'node:test';

import { batchProviderPreferencesKey } from '../src/content/batch-provider-preferences.js';
import { storageKey } from '../src/options/connection.js';
import { assetSourcePreferencesKey } from '../src/shared/asset-source-preferences.js';
import { closeTabPreferencesKey } from '../src/shared/close-tab-preferences.js';
import {
  buildSettingsBundle,
  createRemoteSettingsBundle,
  settingsBundleSchemaVersion,
  settingsBundleSignature,
} from '../src/shared/settings-bundle.js';
import {
  loadSettingsSyncPreferences,
  mergeSettingsWithRemote,
  settingsSyncPreferencesKey,
  settingsSyncStatuses,
  syncExtensionSettings,
  uploadSettingsAfterStorageChange,
  uploadSettingsToRemote,
} from '../src/shared/settings-sync.js';

test('uploads a redacted settings bundle to the connected Atlas domain', async () => {
  const requests = [];
  const storage = createStorage({
    [storageKey]: createConnectionState(),
  });

  await uploadSettingsToRemote({
    fetchImpl: async (url, options) => {
      requests.push({ options, url });

      return {
        ok: true,
        async json() {
          return {
            settings: JSON.parse(options.body).settings,
            updated_at: '2026-06-29T03:00:00.000000Z',
          };
        },
      };
    },
    storage,
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://atlas.example.test/api/extension/settings');
  assert.equal(requests[0].options.method, 'PUT');
  assert.equal(requests[0].options.headers['X-Atlas-Api-Key'], 'secret-key');
  assert.equal(JSON.parse(requests[0].options.body).settings.settings.connection.profiles.live.apiKey, '');

  const preferences = await loadSettingsSyncPreferences(storage);

  assert.equal(preferences.lastStatus, settingsSyncStatuses.uploaded);
  assert.equal(preferences.lastError, '');
  assert.equal(preferences.conflict, null);
  assert.match(preferences.lastSyncedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('startup sync records a conflict when local and remote differ without a baseline', async () => {
  const requests = [];
  const storage = createStorage({
    [assetSourcePreferencesKey]: {
      domains: ['local.example'],
      version: 2,
    },
    [settingsSyncPreferencesKey]: {
      enabled: true,
      version: 1,
    },
    [storageKey]: createConnectionState(),
  });

  const result = await syncExtensionSettings({
    fetchImpl: createRemoteSettingsFetch({
      remoteSettings: createSettingsBundle({ assetDomains: ['remote.example'] }),
      requests,
    }),
    storage,
  });
  const values = await storage.get([assetSourcePreferencesKey, settingsSyncPreferencesKey]);

  assert.equal(result.status, settingsSyncStatuses.conflict);
  assert.deepEqual(values[assetSourcePreferencesKey].domains, ['local.example']);
  assert.equal(values[settingsSyncPreferencesKey].lastStatus, settingsSyncStatuses.conflict);
  assert.match(values[settingsSyncPreferencesKey].lastError, /Choose Download, Upload, or Merge/);
  assert.deepEqual(
    values[settingsSyncPreferencesKey].conflict.differences.map((difference) => difference.key),
    ['assetSourcePreferences'],
  );
  assert.deepEqual(requests.map((request) => request.method), ['GET']);
});

test('startup sync downloads remote settings when only the remote changed since baseline', async () => {
  const requests = [];
  const storage = createStorage({
    [settingsSyncPreferencesKey]: {
      enabled: true,
      version: 1,
    },
    [storageKey]: createConnectionState(),
  });
  const baseline = settingsBundleSignature(createRemoteSettingsBundle(await buildSettingsBundle({ storage })));

  await storage.set({
    [settingsSyncPreferencesKey]: {
      enabled: true,
      lastSyncedSignature: baseline,
      version: 1,
    },
  });

  const result = await syncExtensionSettings({
    fetchImpl: createRemoteSettingsFetch({
      remoteSettings: createSettingsBundle({ assetDomains: ['reddit.com'] }),
      requests,
    }),
    storage,
  });
  const values = await storage.get([assetSourcePreferencesKey, storageKey]);

  assert.equal(result.status, settingsSyncStatuses.downloaded);
  assert.deepEqual(values[assetSourcePreferencesKey].domains, ['reddit.com']);
  assert.equal(values[storageKey].profiles.live.apiKey, 'secret-key');
  assert.deepEqual(requests.map((request) => request.method), ['GET']);
});

test('startup sync uploads local settings when only local changed since baseline', async () => {
  const requests = [];
  const remoteSettings = createSettingsBundle();
  const storage = createStorage({
    [assetSourcePreferencesKey]: {
      domains: ['reddit.com'],
      version: 2,
    },
    [settingsSyncPreferencesKey]: {
      enabled: true,
      lastSyncedSignature: settingsBundleSignature(remoteSettings),
      version: 1,
    },
    [storageKey]: createConnectionState(),
  });

  const result = await syncExtensionSettings({
    fetchImpl: createRemoteSettingsFetch({ remoteSettings, requests }),
    storage,
  });

  assert.equal(result.status, settingsSyncStatuses.uploaded);
  assert.deepEqual(requests.map((request) => request.method), ['GET', 'PUT']);
  assert.deepEqual(JSON.parse(requests[1].body).settings.settings.assetSourcePreferences.domains, [
    'reddit.com',
  ]);
});

test('startup sync uploads local settings when the Atlas domain has no settings yet', async () => {
  const requests = [];
  const storage = createStorage({
    [settingsSyncPreferencesKey]: {
      enabled: true,
      version: 1,
    },
    [storageKey]: createConnectionState(),
  });

  const result = await syncExtensionSettings({
    fetchImpl: createRemoteSettingsFetch({
      remoteSettings: null,
      requests,
    }),
    storage,
  });

  assert.equal(result.status, settingsSyncStatuses.uploaded);
  assert.deepEqual(requests.map((request) => request.method), ['GET', 'PUT']);
});

test('storage-change upload is blocked while a conflict is unresolved', async () => {
  let requestCount = 0;
  const storage = createStorage({
    [settingsSyncPreferencesKey]: {
      conflict: {
        detectedAt: '2026-06-29T03:00:00.000Z',
        differences: [],
        localSignature: 'local',
        remoteSignature: 'remote',
      },
      enabled: true,
      lastStatus: settingsSyncStatuses.conflict,
      version: 1,
    },
    [storageKey]: createConnectionState(),
  });

  const result = await uploadSettingsAfterStorageChange({
    [assetSourcePreferencesKey]: {
      newValue: {
        domains: ['reddit.com'],
        version: 2,
      },
    },
  }, 'local', {
    fetchImpl: async () => {
      requestCount += 1;
    },
    storage,
  });

  assert.equal(result.status, settingsSyncStatuses.skipped);
  assert.equal(requestCount, 0);
});

test('merge resolution combines local and remote settings then uploads the merged bundle', async () => {
  const requests = [];
  const storage = createStorage({
    [assetSourcePreferencesKey]: {
      domains: ['reddit.com'],
      version: 2,
    },
    [batchProviderPreferencesKey]: {
      reddit: true,
    },
    [closeTabPreferencesKey]: {
      modesBySiteDomain: {
        'reddit.com': 'after_queue',
      },
      version: 1,
    },
    [settingsSyncPreferencesKey]: {
      conflict: {
        detectedAt: '2026-06-29T03:00:00.000Z',
        differences: [],
        localSignature: 'local',
        remoteSignature: 'remote',
      },
      enabled: true,
      lastStatus: settingsSyncStatuses.conflict,
      version: 1,
    },
    [storageKey]: createConnectionState(),
  });

  const result = await mergeSettingsWithRemote({
    fetchImpl: createRemoteSettingsFetch({
      remoteSettings: createSettingsBundle({
        assetDomains: ['deviantart.com'],
        batchProviders: {
          deviantart: true,
        },
        closeTabModes: {
          'x.com': 'on_complete',
        },
      }),
      requests,
    }),
    storage,
  });
  const values = await storage.get([
    assetSourcePreferencesKey,
    batchProviderPreferencesKey,
    closeTabPreferencesKey,
    settingsSyncPreferencesKey,
  ]);

  assert.equal(result.status, settingsSyncStatuses.uploaded);
  assert.deepEqual(values[assetSourcePreferencesKey].domains, [
    'deviantart.com',
    'reddit.com',
  ]);
  assert.deepEqual(values[batchProviderPreferencesKey], {
    deviantart: true,
    reddit: true,
  });
  assert.deepEqual(values[closeTabPreferencesKey].modesBySiteDomain, {
    'reddit.com': 'after_queue',
    'x.com': 'on_complete',
  });
  assert.equal(values[settingsSyncPreferencesKey].conflict, null);
  assert.deepEqual(requests.map((request) => request.method), ['GET', 'PUT']);
});

function createRemoteSettingsFetch({ remoteSettings, requests }) {
  return async (url, options = {}) => {
    requests.push({
      body: options.body,
      method: options.method ?? 'GET',
      url,
    });

    return {
      ok: true,
      async json() {
        return options.method === 'PUT'
          ? { settings: JSON.parse(options.body).settings }
          : { settings: remoteSettings };
      },
    };
  };
}

function createSettingsBundle({
  assetDomains = [],
  batchProviders = {},
  closeTabModes = {},
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
      connection: createConnectionState({
        apiKey: '',
      }),
    },
  };
}

function createConnectionState({
  apiKey = 'secret-key',
  domain = 'https://atlas.example.test',
} = {}) {
  return {
    mode: 'live',
    profiles: {
      live: {
        apiKey,
        domain,
        status: 'connected',
      },
      local: {
        status: 'idle',
      },
    },
    version: 2,
  };
}

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
