import {
  loadConnectionState,
  normalizeConnectionState,
  storageKey,
} from '../options/connection-state.js';
import {
  assetSourcePreferencesKey,
  loadAssetSourcePreferences,
  normalizeAssetSourcePreferences,
} from './asset-source-preferences.js';
import {
  closeTabPreferencesKey,
  loadCloseTabPreferences,
  normalizeCloseTabPreferences,
} from './close-tab-preferences.js';
import {
  batchProviderPreferencesKey,
  loadBatchProviderPreferences,
  normalizeBatchProviderPreferences,
} from '../content/batch-provider-preferences.js';

export const settingsBundleSchemaVersion = 1;

export const settingsBundleStorageKeys = Object.freeze([
  assetSourcePreferencesKey,
  batchProviderPreferencesKey,
  closeTabPreferencesKey,
  storageKey,
]);

export async function buildSettingsBundle({
  exportedAt = new Date().toISOString(),
  storage = getExtensionStorage(),
} = {}) {
  if (storage === null) {
    throw new Error('Extension storage is unavailable.');
  }

  return normalizeSettingsBundle({
    exportedAt,
    schemaVersion: settingsBundleSchemaVersion,
    settings: {
      assetSourcePreferences: await loadAssetSourcePreferences(storage),
      batchProviderPreferences: await loadBatchProviderPreferences(storage),
      closeTabPreferences: await loadCloseTabPreferences(storage),
      connection: await loadConnectionState(storage),
    },
  });
}

export async function applySettingsBundle(bundle, {
  preserveConnectionSecrets = false,
  storage = getExtensionStorage(),
} = {}) {
  if (storage === null) {
    throw new Error('Extension storage is unavailable.');
  }

  const normalizedBundle = normalizeSettingsBundle(bundle);
  const connection = preserveConnectionSecrets
    ? await mergeCurrentConnectionSecrets(normalizedBundle.settings.connection, storage)
    : normalizedBundle.settings.connection;

  await storage.set({
    [assetSourcePreferencesKey]: normalizedBundle.settings.assetSourcePreferences,
    [batchProviderPreferencesKey]: normalizedBundle.settings.batchProviderPreferences,
    [closeTabPreferencesKey]: normalizedBundle.settings.closeTabPreferences,
    [storageKey]: connection,
  });

  return {
    ...normalizedBundle,
    settings: {
      ...normalizedBundle.settings,
      connection,
    },
  };
}

export function createRemoteSettingsBundle(bundle) {
  const normalizedBundle = normalizeSettingsBundle(bundle);
  const connection = cloneJson(normalizedBundle.settings.connection);

  if (connection.profiles?.live) {
    connection.profiles.live.apiKey = '';
  }

  return {
    ...normalizedBundle,
    exportedAt: new Date().toISOString(),
    settings: {
      ...normalizedBundle.settings,
      connection,
    },
  };
}

export function summarizeSettingsBundleDifferences(localBundle, remoteBundle) {
  const localSettings = normalizeSettingsBundle(localBundle).settings;
  const remoteSettings = normalizeSettingsBundle(remoteBundle).settings;

  return settingsBundleSections
    .filter((section) => (
      stableStringify(localSettings[section.key]) !== stableStringify(remoteSettings[section.key])
    ))
    .map((section) => ({
      key: section.key,
      label: section.label,
    }));
}

export function mergeSettingsBundles(localBundle, remoteBundle) {
  const localSettings = normalizeSettingsBundle(localBundle).settings;
  const remoteSettings = normalizeSettingsBundle(remoteBundle).settings;

  return normalizeSettingsBundle({
    schemaVersion: settingsBundleSchemaVersion,
    settings: {
      assetSourcePreferences: mergeAssetSourcePreferences(
        localSettings.assetSourcePreferences,
        remoteSettings.assetSourcePreferences,
      ),
      batchProviderPreferences: {
        ...remoteSettings.batchProviderPreferences,
        ...localSettings.batchProviderPreferences,
      },
      closeTabPreferences: mergeCloseTabPreferences(
        localSettings.closeTabPreferences,
        remoteSettings.closeTabPreferences,
      ),
      connection: mergeConnectionSettings(
        localSettings.connection,
        remoteSettings.connection,
      ),
    },
  });
}

export function parseSettingsBundleJson(value) {
  try {
    return normalizeSettingsBundle(JSON.parse(String(value ?? '')));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('Settings file is not valid JSON.', { cause: error });
    }

    throw error;
  }
}

export function normalizeSettingsBundle(value) {
  if (!value || typeof value !== 'object') {
    throw new Error('Settings bundle is invalid.');
  }

  if (value.schemaVersion !== settingsBundleSchemaVersion) {
    throw new Error('Settings bundle version is not supported.');
  }

  const settings = value.settings && typeof value.settings === 'object'
    ? value.settings
    : {};

  return {
    ...(typeof value.exportedAt === 'string' ? { exportedAt: value.exportedAt } : {}),
    schemaVersion: settingsBundleSchemaVersion,
    settings: {
      assetSourcePreferences: normalizeAssetSourcePreferences(settings.assetSourcePreferences),
      batchProviderPreferences: normalizeBatchProviderPreferences(settings.batchProviderPreferences),
      closeTabPreferences: normalizeCloseTabPreferences(settings.closeTabPreferences),
      connection: normalizeConnectionState(settings.connection),
    },
  };
}

export function settingsBundleSignature(bundle) {
  return stableStringify(createRemoteSettingsBundle(bundle).settings);
}

export function isSettingsBundleStorageKey(key) {
  return settingsBundleStorageKeys.includes(key);
}

const settingsBundleSections = Object.freeze([
  {
    key: 'assetSourcePreferences',
    label: 'Asset source profiles',
  },
  {
    key: 'batchProviderPreferences',
    label: 'Batch providers',
  },
  {
    key: 'closeTabPreferences',
    label: 'Close tab modes',
  },
  {
    key: 'connection',
    label: 'Connection profiles',
  },
]);

async function mergeCurrentConnectionSecrets(connection, storage) {
  const currentConnection = await loadConnectionState(storage);
  const nextConnection = cloneJson(connection);
  const currentLiveApiKey = String(currentConnection.profiles.live.apiKey ?? '').trim();
  const nextLiveApiKey = String(nextConnection.profiles.live.apiKey ?? '').trim();

  if (nextLiveApiKey === '' && currentLiveApiKey !== '') {
    nextConnection.profiles.live.apiKey = currentLiveApiKey;
  }

  return normalizeConnectionState(nextConnection);
}

function mergeAssetSourcePreferences(localValue, remoteValue) {
  const localPreferences = normalizeAssetSourcePreferences(localValue);
  const remotePreferences = normalizeAssetSourcePreferences(remoteValue);
  const profilesByDomain = new Map(
    remotePreferences.profiles.map((profile) => [profile.domain, profile]),
  );

  for (const profile of localPreferences.profiles) {
    profilesByDomain.set(profile.domain, profile);
  }

  return normalizeAssetSourcePreferences({
    domains: [
      ...remotePreferences.domains,
      ...localPreferences.domains,
    ],
    profiles: [...profilesByDomain.values()],
  });
}

function mergeCloseTabPreferences(localValue, remoteValue) {
  const localPreferences = normalizeCloseTabPreferences(localValue);
  const remotePreferences = normalizeCloseTabPreferences(remoteValue);

  return normalizeCloseTabPreferences({
    modesBySiteDomain: {
      ...remotePreferences.modesBySiteDomain,
      ...localPreferences.modesBySiteDomain,
    },
  });
}

function mergeConnectionSettings(localValue, remoteValue) {
  const localConnection = normalizeConnectionState(localValue);
  const remoteConnection = normalizeConnectionState(remoteValue);
  const liveProfile = {
    ...remoteConnection.profiles.live,
    ...localConnection.profiles.live,
  };

  if (liveProfile.domain === '' && remoteConnection.profiles.live.domain !== '') {
    liveProfile.domain = remoteConnection.profiles.live.domain;
  }

  return normalizeConnectionState({
    mode: localConnection.mode,
    profiles: {
      live: liveProfile,
      local: {
        ...remoteConnection.profiles.local,
        ...localConnection.profiles.local,
      },
    },
    version: localConnection.version,
  });
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableStringify(value[key])}`
    )).join(',')}}`;
  }

  return JSON.stringify(value);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function getExtensionStorage() {
  return globalThis.chrome?.storage?.local ?? null;
}
