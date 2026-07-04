export const assetSourcePreferencesKey = 'atlasExtensionAssetSourcePreferences';

const assetSourcePreferencesVersion = 3;

export const imageSourcePreferenceValues = {
  highestSrcset: 'srcset-highest',
  src: 'src',
};

export const assetMatchByValues = {
  referrer: 'referrer',
  source: 'source',
};

export const assetMatchQueryCleanupModes = {
  keepSelected: 'keep-selected',
  none: 'none',
  stripAll: 'strip-all',
  stripSelected: 'strip-selected',
};

const fallbackAssetImageSourcePreference = imageSourcePreferenceValues.src;
const domainAssetImageSourcePreferenceDefaults = new Map([
  ['reddit.com', imageSourcePreferenceValues.highestSrcset],
]);

export function createDefaultAssetSourcePreferences() {
  return {
    domains: [],
    profiles: [],
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
  const nextPreferences = createAssetSourcePreferencesFromDomains([
    ...preferences.domains,
    normalizedDomain,
  ], preferences.profiles);

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
  const nextPreferences = createAssetSourcePreferencesFromDomains(
    preferences.domains.filter((domain) => domain !== normalizedDomain),
    preferences.profiles,
  );

  await storage.set({ [assetSourcePreferencesKey]: nextPreferences });

  return nextPreferences;
}

export async function setAssetImageSourcePreference(
  siteDomain,
  imageSourcePreference,
  storage = getExtensionStorage(),
) {
  if (storage === null) {
    throw new Error('Extension storage is unavailable.');
  }

  const normalizedDomain = normalizeAssetSourceDomain(siteDomain);
  const normalizedImageSourcePreference = normalizeImageSourcePreference(imageSourcePreference);

  if (normalizedDomain === null) {
    throw new Error('A valid site domain is required.');
  }

  if (normalizedImageSourcePreference === null) {
    throw new Error('A valid image source preference is required.');
  }

  const preferences = await loadAssetSourcePreferences(storage);
  const profileOverrides = preferences.profiles.map((profile) => {
    if (profile.domain !== normalizedDomain) {
      return profile;
    }

    return {
      ...profile,
      asset: {
        ...profile.asset,
        imageSourcePreference: normalizedImageSourcePreference,
      },
    };
  });
  const nextPreferences = createAssetSourcePreferencesFromDomains(
    preferences.domains,
    profileOverrides,
  );

  await storage.set({ [assetSourcePreferencesKey]: nextPreferences });

  return nextPreferences;
}

export async function setAssetMatchingRule(
  siteDomain,
  matchingRule,
  storage = getExtensionStorage(),
) {
  if (storage === null) {
    throw new Error('Extension storage is unavailable.');
  }

  const normalizedDomain = normalizeAssetSourceDomain(siteDomain);

  if (normalizedDomain === null) {
    throw new Error('A valid site domain is required.');
  }

  const preferences = await loadAssetSourcePreferences(storage);
  const profileOverrides = preferences.profiles.map((profile) => {
    if (profile.domain !== normalizedDomain) {
      return profile;
    }

    return {
      ...profile,
      asset: {
        ...profile.asset,
        matching: normalizeAssetMatchingRule(matchingRule),
      },
    };
  });
  const nextPreferences = createAssetSourcePreferencesFromDomains(
    preferences.domains,
    profileOverrides,
  );

  await storage.set({ [assetSourcePreferencesKey]: nextPreferences });

  return nextPreferences;
}

export function normalizeAssetSourcePreferences(value) {
  if (!value || typeof value !== 'object') {
    return createDefaultAssetSourcePreferences();
  }

  const profiles = Array.isArray(value.profiles) ? value.profiles : [];

  return createAssetSourcePreferencesFromDomains(
    [
      ...normalizeDomainList(value.domains),
      ...profiles.map((profile) => profile?.domain),
    ],
    profiles,
  );
}

export function filterAssetSourceDomains(domains, query) {
  const normalizedDomains = normalizeDomainList(domains);
  const normalizedQuery = String(query ?? '').trim().toLowerCase();

  if (normalizedQuery === '') {
    return normalizedDomains;
  }

  return normalizedDomains.filter((domain) => domain.includes(normalizedQuery));
}

export function getAssetSourceProfile(preferences, siteDomain) {
  const normalizedPreferences = normalizeAssetSourcePreferences(preferences);
  const normalizedDomain = normalizeAssetSourceDomain(siteDomain);

  if (normalizedDomain === null) {
    return null;
  }

  return normalizedPreferences.profiles.find((profile) => profile.domain === normalizedDomain)
    ?? createAssetSourceProfile(normalizedDomain);
}

export function resolveAssetImageSourcePreference(preferences, siteDomain) {
  return getAssetSourceProfile(preferences, siteDomain)?.asset.imageSourcePreference
    ?? fallbackAssetImageSourcePreference;
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

function createAssetSourcePreferencesFromDomains(domains, profileOverrides = []) {
  const normalizedDomains = normalizeDomainList(domains);
  const profileOverridesByDomain = new Map(
    profileOverrides
      .map((profile) => normalizeAssetSourceProfile(profile))
      .filter((profile) => profile !== null)
      .map((profile) => [profile.domain, profile]),
  );

  return {
    domains: normalizedDomains,
    profiles: normalizedDomains.map((domain) => profileOverridesByDomain.get(domain)
      ?? createAssetSourceProfile(domain)),
    version: assetSourcePreferencesVersion,
  };
}

function createAssetSourceProfile(domain) {
  return {
    asset: {
      imageSourcePreference: defaultImageSourcePreferenceForDomain(domain),
      matching: createDefaultAssetMatchingRule(),
    },
    domain,
    referrer: {
      rules: [],
    },
  };
}

function normalizeAssetSourceProfile(value) {
  const domain = normalizeAssetSourceDomain(value?.domain);

  if (domain === null) {
    return null;
  }

  return {
    asset: {
      imageSourcePreference: normalizeImageSourcePreference(value?.asset?.imageSourcePreference)
        ?? defaultImageSourcePreferenceForDomain(domain),
      matching: normalizeAssetMatchingRule(value?.asset?.matching),
    },
    domain,
    referrer: {
      rules: Array.isArray(value?.referrer?.rules) ? value.referrer.rules : [],
    },
  };
}

export function createDefaultAssetMatchingRule() {
  return {
    cleanup: {
      query: {
        mode: assetMatchQueryCleanupModes.none,
        params: [],
      },
      removeFragment: false,
    },
    matchBy: assetMatchByValues.source,
    ruleId: '',
  };
}

export function normalizeAssetMatchingRule(value) {
  if (!value || typeof value !== 'object') {
    return createDefaultAssetMatchingRule();
  }

  const matchBy = Object.values(assetMatchByValues).includes(value.matchBy)
    ? value.matchBy
    : assetMatchByValues.source;
  const query = value.cleanup && typeof value.cleanup === 'object' && value.cleanup.query
    && typeof value.cleanup.query === 'object'
    ? value.cleanup.query
    : {};
  const queryMode = Object.values(assetMatchQueryCleanupModes).includes(query.mode)
    ? query.mode
    : assetMatchQueryCleanupModes.none;
  const queryParams = queryMode === assetMatchQueryCleanupModes.none
    ? []
    : normalizeQueryParams(query.params);

  return {
    cleanup: {
      query: {
        mode: queryMode,
        params: queryParams,
      },
      removeFragment: value.cleanup?.removeFragment === true,
    },
    matchBy,
    ruleId: typeof value.ruleId === 'string' ? value.ruleId.trim() : '',
  };
}

function defaultImageSourcePreferenceForDomain(domain) {
  return domainAssetImageSourcePreferenceDefaults.get(domain) ?? fallbackAssetImageSourcePreference;
}

function normalizeImageSourcePreference(value) {
  return Object.values(imageSourcePreferenceValues).includes(value) ? value : null;
}

function normalizeQueryParams(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(
    value
      .map((param) => String(param ?? '').trim().toLowerCase())
      .filter((param) => param !== ''),
  )];
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
