export const assetSourcePreferencesKey = 'atlasExtensionAssetSourcePreferences';

const assetSourcePreferencesVersion = 1;

export function createDefaultAssetSourcePreferences() {
  return {
    domains: [],
    version: assetSourcePreferencesVersion,
  };
}

export async function loadAssetSourcePreferences(storage = getExtensionStorage()) {
  if (storage === null) {
    return createDefaultAssetSourcePreferences();
  }

  const result = await readStorageValue(storage, assetSourcePreferencesKey);

  return normalizeAssetSourcePreferences(result[assetSourcePreferencesKey]);
}

export async function addAssetSourceDomain(siteDomain, storage = getExtensionStorage()) {
  if (storage === null) {
    throw new Error('Extension storage is unavailable.');
  }

  const normalizedDomain = normalizeAssetSourceDomain(siteDomain);

  if (normalizedDomain === null) {
    throw new Error('A valid site domain is required.');
  }

  const preferences = await loadAssetSourcePreferences(storage);
  const domains = normalizeDomainList([
    ...preferences.domains,
    normalizedDomain,
  ]);
  const nextPreferences = {
    domains,
    version: assetSourcePreferencesVersion,
  };

  await storage.set({ [assetSourcePreferencesKey]: nextPreferences });

  return nextPreferences;
}

export async function removeAssetSourceDomain(siteDomain, storage = getExtensionStorage()) {
  if (storage === null) {
    throw new Error('Extension storage is unavailable.');
  }

  const normalizedDomain = normalizeAssetSourceDomain(siteDomain);

  if (normalizedDomain === null) {
    throw new Error('A valid site domain is required.');
  }

  const preferences = await loadAssetSourcePreferences(storage);
  const nextPreferences = {
    domains: preferences.domains.filter((domain) => domain !== normalizedDomain),
    version: assetSourcePreferencesVersion,
  };

  await storage.set({ [assetSourcePreferencesKey]: nextPreferences });

  return nextPreferences;
}

export function normalizeAssetSourcePreferences(value) {
  if (!value || typeof value !== 'object') {
    return createDefaultAssetSourcePreferences();
  }

  return {
    domains: normalizeDomainList(value.domains),
    version: assetSourcePreferencesVersion,
  };
}

export function filterAssetSourceDomains(domains, query) {
  const normalizedDomains = normalizeDomainList(domains);
  const normalizedQuery = String(query ?? '').trim().toLowerCase();

  if (normalizedQuery === '') {
    return normalizedDomains;
  }

  return normalizedDomains.filter((domain) => domain.includes(normalizedQuery));
}

export function normalizeAssetSourceDomain(value) {
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

function normalizeDomainList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(
    value
      .map((domain) => normalizeAssetSourceDomain(domain))
      .filter((domain) => domain !== null),
  )].sort();
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
