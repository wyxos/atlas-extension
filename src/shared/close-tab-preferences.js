export const closeTabPreferencesKey = 'atlasExtensionCloseTabModes';

export const closeTabModes = Object.freeze({
  afterQueue: 'after_queue',
  off: 'off',
  onComplete: 'on_complete',
});

const closeTabPreferencesVersion = 1;

export async function loadCloseTabPreferences(storage = getExtensionStorage()) {
  if (storage === null) {
    return createDefaultCloseTabPreferences();
  }

  const result = await readStorageValue(storage, closeTabPreferencesKey);

  return normalizeCloseTabPreferences(result[closeTabPreferencesKey]);
}

export async function loadCloseTabModeForSiteDomain(siteDomain, storage = getExtensionStorage()) {
  const normalizedSiteDomain = normalizeSiteDomain(siteDomain);

  if (normalizedSiteDomain === null) {
    return closeTabModes.off;
  }

  const preferences = await loadCloseTabPreferences(storage);

  return preferences.modesBySiteDomain[normalizedSiteDomain] ?? closeTabModes.off;
}

export async function saveCloseTabModeForSiteDomain(siteDomain, mode, storage = getExtensionStorage()) {
  if (storage === null) {
    throw new Error('Extension storage is unavailable.');
  }

  const normalizedSiteDomain = normalizeSiteDomain(siteDomain);
  const normalizedMode = normalizeCloseTabMode(mode);

  if (normalizedSiteDomain === null) {
    throw new Error('A valid site domain is required.');
  }

  const preferences = await loadCloseTabPreferences(storage);
  const modesBySiteDomain = {
    ...preferences.modesBySiteDomain,
  };

  if (normalizedMode === closeTabModes.off) {
    delete modesBySiteDomain[normalizedSiteDomain];
  } else {
    modesBySiteDomain[normalizedSiteDomain] = normalizedMode;
  }

  const nextPreferences = {
    modesBySiteDomain,
    version: closeTabPreferencesVersion,
  };

  await storage.set({ [closeTabPreferencesKey]: nextPreferences });

  return nextPreferences;
}

export function normalizeCloseTabPreferences(value) {
  if (!value || typeof value !== 'object') {
    return createDefaultCloseTabPreferences();
  }

  const rawModes = value.modesBySiteDomain && typeof value.modesBySiteDomain === 'object'
    ? value.modesBySiteDomain
    : {};
  const modesBySiteDomain = {};

  for (const [siteDomain, mode] of Object.entries(rawModes)) {
    const normalizedSiteDomain = normalizeSiteDomain(siteDomain);
    const normalizedMode = normalizeCloseTabMode(mode);

    if (normalizedSiteDomain !== null && normalizedMode !== closeTabModes.off) {
      modesBySiteDomain[normalizedSiteDomain] = normalizedMode;
    }
  }

  return {
    modesBySiteDomain,
    version: closeTabPreferencesVersion,
  };
}

export function normalizeCloseTabMode(value) {
  return Object.values(closeTabModes).includes(value) ? value : closeTabModes.off;
}

export function closeTabPreferencesFromStorageChange(changes, areaName) {
  if (areaName !== 'local' || !(closeTabPreferencesKey in (changes ?? {}))) {
    return null;
  }

  return normalizeCloseTabPreferences(changes[closeTabPreferencesKey]?.newValue);
}

export function normalizeSiteDomain(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();

  if (trimmed === '') {
    return null;
  }

  try {
    const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    const url = new URL(candidate);

    if (!['http:', 'https:'].includes(url.protocol)) {
      return null;
    }

    const hostname = url.hostname.toLowerCase().replace(/^www\./, '');

    return hostname === '' ? null : hostname;
  } catch {
    return null;
  }
}

function createDefaultCloseTabPreferences() {
  return {
    modesBySiteDomain: {},
    version: closeTabPreferencesVersion,
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
