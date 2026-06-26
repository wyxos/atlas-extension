export const batchProviderPreferencesKey = 'atlasExtensionBatchProviders';

export async function loadBatchProviderPreferences(storage = getExtensionStorage()) {
  if (storage === null) {
    return {};
  }

  const result = await readStorageValue(storage, batchProviderPreferencesKey);

  return normalizeBatchProviderPreferences(result[batchProviderPreferencesKey]);
}

export async function saveBatchProviderPreference(provider, enabled, storage = getExtensionStorage()) {
  if (storage === null || !isProviderName(provider)) {
    return {};
  }

  const preferences = await loadBatchProviderPreferences(storage);

  if (enabled === true) {
    preferences[provider] = true;
  } else {
    delete preferences[provider];
  }

  await storage.set({ [batchProviderPreferencesKey]: preferences });

  return preferences;
}

export function bindBatchProviderPreferences({
  applyPreferences,
  onChanged = globalThis.chrome?.storage?.onChanged,
  storage = getExtensionStorage(),
} = {}) {
  if (typeof applyPreferences !== 'function') {
    return;
  }

  void loadBatchProviderPreferences(storage).then(applyPreferences);
  onChanged?.addListener?.((changes, areaName) => {
    const preferences = batchProviderPreferencesFromStorageChange(changes, areaName);

    if (preferences !== null) {
      applyPreferences(preferences);
    }
  });
}

export function normalizeBatchProviderPreferences(value) {
  if (!value || typeof value !== 'object') {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([provider, enabled]) => isProviderName(provider) && enabled === true),
  );
}

export function batchProviderPreferencesFromStorageChange(changes, areaName) {
  if (areaName !== 'local' || !(batchProviderPreferencesKey in (changes ?? {}))) {
    return null;
  }

  return normalizeBatchProviderPreferences(changes[batchProviderPreferencesKey]?.newValue);
}

function getExtensionStorage() {
  return globalThis.chrome?.storage?.local ?? null;
}

function isProviderName(value) {
  return typeof value === 'string' && value.trim() !== '';
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
