import {
  isConnectableConfig,
  loadConnectionConfig,
  normalizeDomain,
} from '../options/connection.js';
import {
  applySettingsBundle,
  buildSettingsBundle,
  createRemoteSettingsBundle,
  isSettingsBundleStorageKey,
  mergeSettingsBundles,
  normalizeSettingsBundle,
  settingsBundleSignature,
  summarizeSettingsBundleDifferences,
} from './settings-bundle.js';

export const settingsSyncPreferencesKey = 'atlasExtensionSettingsSync';

const settingsSyncPreferencesVersion = 1;

export const settingsSyncStatuses = Object.freeze({
  conflict: 'conflict',
  downloaded: 'downloaded',
  failed: 'failed',
  idle: 'idle',
  skipped: 'skipped',
  synced: 'synced',
  uploaded: 'uploaded',
});

const settingsSyncConflictMessage = 'Settings differ between this browser and Atlas. Choose Download, Upload, or Merge.';

export function createDefaultSettingsSyncPreferences() {
  return {
    conflict: null,
    enabled: false,
    lastError: '',
    lastStatus: settingsSyncStatuses.idle,
    lastSyncedAt: null,
    lastSyncedSignature: '',
    version: settingsSyncPreferencesVersion,
  };
}

export async function loadSettingsSyncPreferences(storage = getExtensionStorage()) {
  if (storage === null) {
    return createDefaultSettingsSyncPreferences();
  }

  const result = await readStorageValue(storage, settingsSyncPreferencesKey);

  return normalizeSettingsSyncPreferences(result[settingsSyncPreferencesKey]);
}

export async function setSettingsSyncEnabled(enabled, storage = getExtensionStorage()) {
  const preferences = await loadSettingsSyncPreferences(storage);
  const nextEnabled = enabled === true;

  return saveSettingsSyncPreferences({
    ...preferences,
    conflict: nextEnabled ? preferences.conflict : null,
    enabled: nextEnabled,
    lastError: '',
    lastStatus: nextEnabled ? preferences.lastStatus : settingsSyncStatuses.idle,
  }, storage);
}

export async function uploadSettingsToRemote({
  fetchImpl = globalThis.fetch,
  storage = getExtensionStorage(),
} = {}) {
  const config = await loadConnectionConfig(storage);
  const bundle = createRemoteSettingsBundle(await buildSettingsBundle({ storage }));
  const payload = await atlasSettingsRequest({
    body: { settings: bundle },
    config,
    fetchImpl,
    method: 'PUT',
  });
  const savedBundle = normalizeSettingsBundle(payload.settings ?? bundle);

  await saveSyncSuccess(storage, settingsSyncStatuses.uploaded, savedBundle);

  return {
    settings: savedBundle,
    status: settingsSyncStatuses.uploaded,
  };
}

export async function downloadSettingsFromRemote({
  fetchImpl = globalThis.fetch,
  storage = getExtensionStorage(),
} = {}) {
  const remote = await fetchSettingsFromRemote({ fetchImpl, storage });

  if (remote.settings === null) {
    return {
      settings: null,
      status: settingsSyncStatuses.skipped,
    };
  }

  return applyDownloadedSettings(remote.settings, storage);
}

export async function syncExtensionSettings({
  fetchImpl = globalThis.fetch,
  storage = getExtensionStorage(),
} = {}) {
  const preferences = await loadSettingsSyncPreferences(storage);

  if (!preferences.enabled) {
    return { status: settingsSyncStatuses.skipped };
  }

  try {
    const remote = await fetchSettingsFromRemote({ fetchImpl, storage });

    if (remote.settings === null) {
      return uploadSettingsToRemote({ fetchImpl, storage });
    }

    const localBundle = createRemoteSettingsBundle(await buildSettingsBundle({ storage }));
    const remoteBundle = normalizeSettingsBundle(remote.settings);
    const localSignature = settingsBundleSignature(localBundle);
    const remoteSignature = settingsBundleSignature(remoteBundle);

    if (localSignature === remoteSignature) {
      await saveSyncSuccess(storage, settingsSyncStatuses.synced, localBundle);

      return {
        settings: localBundle,
        status: settingsSyncStatuses.synced,
      };
    }

    if (preferences.lastSyncedSignature !== '') {
      if (localSignature === preferences.lastSyncedSignature) {
        return applyDownloadedSettings(remoteBundle, storage);
      }

      if (remoteSignature === preferences.lastSyncedSignature) {
        return uploadSettingsToRemote({ fetchImpl, storage });
      }
    }

    const conflict = createSettingsSyncConflict(localBundle, remoteBundle);

    await saveSyncConflict(storage, conflict);

    return {
      conflict,
      status: settingsSyncStatuses.conflict,
    };
  } catch (error) {
    await saveSyncFailure(storage, error);

    return {
      error: error?.message ?? 'Settings sync failed.',
      status: settingsSyncStatuses.failed,
    };
  }
}

export async function uploadSettingsAfterStorageChange(changes, areaName, {
  fetchImpl = globalThis.fetch,
  storage = getExtensionStorage(),
} = {}) {
  if (!hasSettingsStorageChange(changes, areaName)) {
    return { status: settingsSyncStatuses.skipped };
  }

  const preferences = await loadSettingsSyncPreferences(storage);

  if (!preferences.enabled) {
    return { status: settingsSyncStatuses.skipped };
  }

  if (preferences.lastStatus === settingsSyncStatuses.conflict || preferences.conflict !== null) {
    return { status: settingsSyncStatuses.skipped };
  }

  try {
    const bundle = createRemoteSettingsBundle(await buildSettingsBundle({ storage }));
    const signature = settingsBundleSignature(bundle);

    if (signature === preferences.lastSyncedSignature) {
      return { status: settingsSyncStatuses.skipped };
    }

    return uploadSettingsToRemote({ fetchImpl, storage });
  } catch (error) {
    await saveSyncFailure(storage, error);

    return {
      error: error?.message ?? 'Settings upload failed.',
      status: settingsSyncStatuses.failed,
    };
  }
}

export async function mergeSettingsWithRemote({
  fetchImpl = globalThis.fetch,
  storage = getExtensionStorage(),
} = {}) {
  const remote = await fetchSettingsFromRemote({ fetchImpl, storage });

  if (remote.settings === null) {
    throw new Error('No remote settings found to merge.');
  }

  const mergedBundle = mergeSettingsBundles(
    await buildSettingsBundle({ storage }),
    remote.settings,
  );

  await applySettingsBundle(mergedBundle, {
    preserveConnectionSecrets: true,
    storage,
  });

  return uploadSettingsToRemote({ fetchImpl, storage });
}

export function hasSettingsStorageChange(changes, areaName) {
  return areaName === 'local'
    && Object.keys(changes ?? {}).some((key) => isSettingsBundleStorageKey(key));
}

export function normalizeSettingsSyncPreferences(value) {
  if (!value || typeof value !== 'object') {
    return createDefaultSettingsSyncPreferences();
  }

  return {
    conflict: normalizeSettingsSyncConflict(value.conflict),
    enabled: value.enabled === true,
    lastError: typeof value.lastError === 'string' ? value.lastError : '',
    lastStatus: Object.values(settingsSyncStatuses).includes(value.lastStatus)
      ? value.lastStatus
      : settingsSyncStatuses.idle,
    lastSyncedAt: typeof value.lastSyncedAt === 'string' ? value.lastSyncedAt : null,
    lastSyncedSignature: typeof value.lastSyncedSignature === 'string'
      ? value.lastSyncedSignature
      : '',
    version: settingsSyncPreferencesVersion,
  };
}

async function fetchSettingsFromRemote({
  fetchImpl = globalThis.fetch,
  storage = getExtensionStorage(),
} = {}) {
  const config = await loadConnectionConfig(storage);
  const payload = await atlasSettingsRequest({
    config,
    fetchImpl,
    method: 'GET',
  });

  return {
    settings: payload.settings === null || payload.settings === undefined
      ? null
      : normalizeSettingsBundle(payload.settings),
    status: settingsSyncStatuses.downloaded,
  };
}

async function applyDownloadedSettings(remoteSettings, storage) {
  const bundle = await applySettingsBundle(remoteSettings, {
    preserveConnectionSecrets: true,
    storage,
  });

  await saveSyncSuccess(storage, settingsSyncStatuses.downloaded, bundle);

  return {
    settings: bundle,
    status: settingsSyncStatuses.downloaded,
  };
}

function createSettingsSyncConflict(localBundle, remoteBundle) {
  return {
    detectedAt: new Date().toISOString(),
    differences: summarizeSettingsBundleDifferences(localBundle, remoteBundle),
    localSignature: settingsBundleSignature(localBundle),
    remoteSignature: settingsBundleSignature(remoteBundle),
  };
}

async function atlasSettingsRequest({
  body,
  config,
  fetchImpl,
  method,
}) {
  const domain = normalizeDomain(config?.domain);
  const apiKey = String(config?.apiKey ?? '').trim();

  if (domain === null || apiKey === '' || typeof fetchImpl !== 'function' || !isConnectableConfig(config)) {
    throw new Error('Atlas extension connection is not configured.');
  }

  const response = await fetchImpl(`${domain}/api/extension/settings`, {
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: {
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      'X-Atlas-Api-Key': apiKey,
    },
    method,
  });
  const payload = await readJson(response);

  if (!response.ok) {
    throw new Error(payload?.message ?? 'Atlas settings sync failed.');
  }

  return payload ?? {};
}

async function saveSyncSuccess(storage, status, bundle) {
  const preferences = await loadSettingsSyncPreferences(storage);

  await saveSettingsSyncPreferences({
    ...preferences,
    conflict: null,
    lastError: '',
    lastStatus: status,
    lastSyncedAt: new Date().toISOString(),
    lastSyncedSignature: settingsBundleSignature(bundle),
  }, storage);
}

async function saveSyncFailure(storage, error) {
  const preferences = await loadSettingsSyncPreferences(storage);

  await saveSettingsSyncPreferences({
    ...preferences,
    lastError: error?.message ?? 'Settings sync failed.',
    lastStatus: settingsSyncStatuses.failed,
  }, storage);
}

async function saveSyncConflict(storage, conflict) {
  const preferences = await loadSettingsSyncPreferences(storage);

  await saveSettingsSyncPreferences({
    ...preferences,
    conflict,
    lastError: settingsSyncConflictMessage,
    lastStatus: settingsSyncStatuses.conflict,
  }, storage);
}

async function saveSettingsSyncPreferences(preferences, storage = getExtensionStorage()) {
  if (storage === null) {
    throw new Error('Extension storage is unavailable.');
  }

  const normalized = normalizeSettingsSyncPreferences(preferences);

  await storage.set({ [settingsSyncPreferencesKey]: normalized });

  return normalized;
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function normalizeSettingsSyncConflict(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const localSignature = typeof value.localSignature === 'string' ? value.localSignature : '';
  const remoteSignature = typeof value.remoteSignature === 'string' ? value.remoteSignature : '';

  if (localSignature === '' || remoteSignature === '') {
    return null;
  }

  return {
    detectedAt: typeof value.detectedAt === 'string' ? value.detectedAt : null,
    differences: Array.isArray(value.differences)
      ? value.differences
        .filter((difference) => (
          typeof difference?.key === 'string' && typeof difference?.label === 'string'
        ))
        .map((difference) => ({
          key: difference.key,
          label: difference.label,
        }))
      : [],
    localSignature,
    remoteSignature,
  };
}

function getExtensionStorage() {
  return globalThis.chrome?.storage?.local ?? null;
}

async function readStorageValue(storage, key) {
  if (typeof storage?.get !== 'function') {
    return {};
  }

  if (storage.get.length >= 2) {
    return new Promise((resolve) => {
      try {
        storage.get(key, (result) => resolve(result ?? {}));
      } catch {
        resolve({});
      }
    });
  }

  try {
    return await storage.get(key) ?? {};
  } catch {
    return {};
  }
}
