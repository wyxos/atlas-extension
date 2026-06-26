export const connectionModes = Object.freeze({
  live: 'live',
  local: 'local',
});

export const connectionStatuses = Object.freeze({
  connected: 'connected',
  failed: 'failed',
  idle: 'idle',
});

export const reverbStatuses = Object.freeze({
  connected: 'connected',
  disabled: 'disabled',
  failed: 'failed',
  idle: 'idle',
});

export const defaultDomain = '';

export const defaultApiKey = '';

export const localDomain = 'https://atlas.test';

export const localApiKey = 'atlas_local_development_key';

export const storageKey = 'atlasExtensionConfig';

const connectionStorageVersion = 2;

export function createDefaultConnectionState() {
  return {
    mode: connectionModes.live,
    profiles: {
      live: createDefaultLiveProfile(),
      local: createDefaultLocalProfile(),
    },
    version: connectionStorageVersion,
  };
}

export async function loadConnectionState(storage = getExtensionStorage(), options = {}) {
  if (storage === null) {
    return createDefaultConnectionState();
  }

  const result = await readStorageValue(storage, storageKey, {
    timeoutMs: options.storageTimeoutMs,
  });

  return normalizeConnectionState(result[storageKey]);
}

export async function saveConnectionState(state, storage = getExtensionStorage()) {
  if (storage === null) {
    throw new Error('Extension storage is unavailable.');
  }

  const nextState = normalizeConnectionState(state);

  await storage.set({ [storageKey]: nextState });

  return nextState;
}

export async function saveConnectionMode(mode, storage = getExtensionStorage()) {
  const state = await loadConnectionState(storage);
  const nextState = {
    ...state,
    mode: isConnectionMode(mode) ? mode : connectionModes.live,
  };

  return saveConnectionState(nextState, storage);
}

export async function loadConnectionConfig(storage = getExtensionStorage(), options = {}) {
  const state = await loadConnectionState(storage, options);

  return resolveActiveConnectionConfig(state);
}

export async function saveConnectionConfig(config, storage = getExtensionStorage()) {
  const domain = normalizeDomain(config?.domain);
  const apiKey = String(config?.apiKey ?? '').trim();

  if (storage === null || domain === null || apiKey === '') {
    throw new Error('Connection settings are incomplete.');
  }

  const state = await loadConnectionState(storage);
  const mode = resolveConfigMode(config, domain, apiKey);
  const nextState = {
    ...state,
    mode,
    profiles: {
      live: state.profiles.live,
      local: state.profiles.local,
      [mode]: createStoredProfileFromConfig(config, mode, domain, apiKey),
    },
  };

  await storage.set({ [storageKey]: nextState });

  return resolveConnectionProfileConfig(nextState.profiles[mode], mode);
}

export function resolveActiveConnectionConfig(state) {
  const normalizedState = normalizeConnectionState(state);
  const mode = normalizedState.mode;

  return resolveConnectionProfileConfig(normalizedState.profiles[mode], mode);
}

export function resolveConnectionProfileConfig(profile, mode) {
  const normalizedMode = isConnectionMode(mode) ? mode : connectionModes.live;
  const storedProfile = normalizedMode === connectionModes.local
    ? normalizeLocalProfile(profile)
    : normalizeLiveProfile(profile);
  const config = {
    apiKey: normalizedMode === connectionModes.local
      ? localApiKey
      : storedProfile.apiKey,
    domain: normalizedMode === connectionModes.local
      ? localDomain
      : storedProfile.domain,
    mode: normalizedMode,
    status: storedProfile.status,
  };

  for (const key of ['checkedAt', 'connectedAt', 'reverb']) {
    if (storedProfile[key] !== undefined) {
      config[key] = storedProfile[key];
    }
  }

  return config;
}

export function normalizeConnectionState(value) {
  if (value?.version === connectionStorageVersion && typeof value?.profiles === 'object') {
    return {
      mode: isConnectionMode(value.mode) ? value.mode : connectionModes.live,
      profiles: {
        live: normalizeLiveProfile(value.profiles.live),
        local: normalizeLocalProfile(value.profiles.local),
      },
      version: connectionStorageVersion,
    };
  }

  return migrateLegacyConnectionConfig(value);
}

export function normalizeDomain(value) {
  const trimmedValue = String(value ?? '').trim();

  if (trimmedValue === '') {
    return null;
  }

  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmedValue)
    ? trimmedValue
    : `https://${trimmedValue}`;

  try {
    const url = new URL(candidate);

    if (!['http:', 'https:'].includes(url.protocol)) {
      return null;
    }

    return url.origin;
  } catch {
    return null;
  }
}

export function isConnectionMode(value) {
  return Object.values(connectionModes).includes(value);
}

export function isConnectionStatus(value) {
  return Object.values(connectionStatuses).includes(value);
}

export function isReverbStatus(value) {
  return Object.values(reverbStatuses).includes(value);
}

export function normalizeReverbState(reverb) {
  const status = isReverbStatus(reverb?.status)
    ? reverb.status
    : reverbStatuses.idle;
  const normalized = {
    status,
  };

  for (const key of ['checkedAt', 'channel', 'enabled', 'host', 'key', 'port', 'scheme']) {
    if (reverb[key] !== undefined && reverb[key] !== null) {
      normalized[key] = reverb[key];
    }
  }

  return normalized;
}

function migrateLegacyConnectionConfig(value) {
  const defaultState = createDefaultConnectionState();
  const domain = normalizeDomain(value?.domain);
  const apiKey = String(value?.apiKey ?? '').trim();

  if (domain === null || apiKey === '') {
    return defaultState;
  }

  const mode = domain === localDomain && apiKey === localApiKey
    ? connectionModes.local
    : connectionModes.live;

  return {
    ...defaultState,
    mode,
    profiles: {
      live: mode === connectionModes.live
        ? createStoredProfileFromConfig(value, mode, domain, apiKey, { addConnectedAt: false })
        : defaultState.profiles.live,
      local: mode === connectionModes.local
        ? createStoredProfileFromConfig(value, mode, domain, apiKey, { addConnectedAt: false })
        : defaultState.profiles.local,
    },
  };
}

function createStoredProfileFromConfig(config, mode, domain, apiKey, options = {}) {
  const status = isConnectionStatus(config?.status)
    ? config.status
    : connectionStatuses.connected;
  const profile = {
    status,
  };

  if (mode === connectionModes.live) {
    profile.apiKey = apiKey;
    profile.domain = domain;
  }

  for (const key of ['checkedAt', 'connectedAt']) {
    if (typeof config?.[key] === 'string') {
      profile[key] = config[key];
    }
  }

  if (config?.reverb && typeof config.reverb === 'object') {
    profile.reverb = normalizeReverbState(config.reverb);
  }

  if (
    status === connectionStatuses.connected
    && profile.connectedAt === undefined
    && options.addConnectedAt !== false
  ) {
    profile.connectedAt = typeof config?.checkedAt === 'string'
      ? config.checkedAt
      : new Date().toISOString();
  }

  return mode === connectionModes.local
    ? normalizeLocalProfile(profile)
    : normalizeLiveProfile(profile);
}

function normalizeLiveProfile(profile) {
  const domain = normalizeDomain(profile?.domain);
  const normalized = {
    apiKey: String(profile?.apiKey ?? '').trim(),
    domain: domain ?? '',
    status: isConnectionStatus(profile?.status)
      ? profile.status
      : connectionStatuses.idle,
  };

  copyProfileMetadata(normalized, profile);

  return normalized;
}

function normalizeLocalProfile(profile) {
  const normalized = {
    status: isConnectionStatus(profile?.status)
      ? profile.status
      : connectionStatuses.idle,
  };

  copyProfileMetadata(normalized, profile);

  return normalized;
}

function copyProfileMetadata(target, source) {
  for (const key of ['checkedAt', 'connectedAt']) {
    if (typeof source?.[key] === 'string') {
      target[key] = source[key];
    }
  }

  if (source?.reverb && typeof source.reverb === 'object') {
    target.reverb = normalizeReverbState(source.reverb);
  }
}

function createDefaultLiveProfile() {
  return {
    apiKey: defaultApiKey,
    domain: defaultDomain,
    status: connectionStatuses.idle,
  };
}

function createDefaultLocalProfile() {
  return {
    status: connectionStatuses.idle,
  };
}

function resolveConfigMode(config, domain, apiKey) {
  if (isConnectionMode(config?.mode)) {
    return config.mode;
  }

  return domain === localDomain && apiKey === localApiKey
    ? connectionModes.local
    : connectionModes.live;
}

function getExtensionStorage() {
  return globalThis.chrome?.storage?.local ?? null;
}

function readStorageValue(storage, key, options = {}) {
  if (typeof storage?.get !== 'function') {
    return {};
  }

  const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : 1000;

  if (storage.get.length >= 2) {
    return withTimeout(new Promise((resolve) => {
      try {
        storage.get(key, (result) => resolve(result ?? {}));
      } catch {
        resolve({});
      }
    }), timeoutMs, {});
  }

  try {
    return withTimeout(storage.get(key), timeoutMs, {});
  } catch {
    return {};
  }
}

function withTimeout(promise, timeoutMs, fallback) {
  return new Promise((resolve) => {
    let settled = false;
    const timeoutId = globalThis.setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(fallback);
      }
    }, timeoutMs);

    Promise.resolve(promise)
      .then((value) => {
        if (!settled) {
          settled = true;
          globalThis.clearTimeout(timeoutId);
          resolve(value ?? fallback);
        }
      })
      .catch(() => {
        if (!settled) {
          settled = true;
          globalThis.clearTimeout(timeoutId);
          resolve(fallback);
        }
      });
  });
}
