export const defaultDomain = 'https://atlas.test';

export const defaultApiKey = 'atlas_local_development_key';

export const storageKey = 'atlasExtensionConfig';

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

export function isConnectableConfig(config) {
  return normalizeDomain(config?.domain) !== null
    && String(config?.apiKey ?? '').trim() !== '';
}

export function getStatusLabel(status) {
  if (status === connectionStatuses.connected) {
    return 'Connected';
  }

  if (status === connectionStatuses.failed) {
    return 'Failed';
  }

  return 'Not connected';
}

export function getStatusVariant(status) {
  if (status === connectionStatuses.failed) {
    return 'danger';
  }

  if (status === connectionStatuses.connected) {
    return 'success';
  }

  return 'outline';
}

export function getReverbStatusLabel(status) {
  if (status === reverbStatuses.connected) {
    return 'Reverb connected';
  }

  if (status === reverbStatuses.failed) {
    return 'Reverb failed';
  }

  if (status === reverbStatuses.disabled) {
    return 'Reverb disabled';
  }

  return 'Reverb not checked';
}

export function getReverbStatusVariant(status) {
  if (status === reverbStatuses.failed) {
    return 'danger';
  }

  if (status === reverbStatuses.connected) {
    return 'success';
  }

  return 'outline';
}

export async function loadConnectionConfig(storage = getExtensionStorage(), options = {}) {
  if (storage === null) {
    return null;
  }

  const result = await readStorageValue(storage, storageKey, {
    timeoutMs: options.storageTimeoutMs,
  });

  return result[storageKey] ?? null;
}

export async function saveConnectionConfig(config, storage = getExtensionStorage()) {
  const domain = normalizeDomain(config?.domain);
  const apiKey = String(config?.apiKey ?? '').trim();

  if (storage === null || domain === null || apiKey === '') {
    throw new Error('Connection settings are incomplete.');
  }

  const status = isConnectionStatus(config?.status)
    ? config.status
    : connectionStatuses.connected;
  const checkedAt = typeof config?.checkedAt === 'string'
    ? config.checkedAt
    : new Date().toISOString();
  const nextConfig = {
    apiKey,
    checkedAt,
    domain,
    status,
  };

  if (config?.reverb && typeof config.reverb === 'object') {
    nextConfig.reverb = normalizeReverbState(config.reverb);
  }

  if (status === connectionStatuses.connected) {
    nextConfig.connectedAt = typeof config?.connectedAt === 'string'
      ? config.connectedAt
      : checkedAt;
  }

  await storage.set({ [storageKey]: nextConfig });

  return nextConfig;
}

export async function verifyConnection(config, options = {}) {
  const fetchImpl = typeof options === 'function'
    ? options
    : options.fetchImpl ?? globalThis.fetch;
  const WebSocketImpl = typeof options === 'function'
    ? globalThis.WebSocket
    : options.WebSocketImpl ?? globalThis.WebSocket;
  const reverbTimeoutMs = typeof options?.reverbTimeoutMs === 'number'
    ? options.reverbTimeoutMs
    : 3000;
  const domain = normalizeDomain(config?.domain);
  const apiKey = String(config?.apiKey ?? '').trim();
  const checkedAt = new Date().toISOString();
  const unverifiedReverb = {
    checkedAt,
    status: reverbStatuses.idle,
  };

  if (domain === null || apiKey === '' || typeof fetchImpl !== 'function') {
    return {
      apiKey,
      checkedAt,
      domain,
      reverb: unverifiedReverb,
      status: connectionStatuses.failed,
    };
  }

  try {
    const response = await fetchImpl(`${domain}/api/extension/ping`, {
      headers: {
        Accept: 'application/json',
        'X-Atlas-Api-Key': apiKey,
      },
      method: 'GET',
    });
    const payload = await readJsonResponse(response);
    const apiConnected = response.ok && payload?.ok === true;
    const reverb = apiConnected && payload?.reverb
      ? await verifyReverbConnection(payload.reverb, {
        checkedAt,
        timeoutMs: reverbTimeoutMs,
        WebSocketImpl,
      })
      : unverifiedReverb;
    const status = apiConnected && isReverbAcceptable(reverb.status)
      ? connectionStatuses.connected
      : connectionStatuses.failed;
    const nextConfig = {
      apiKey,
      checkedAt,
      domain,
      reverb,
      status,
    };

    if (status === connectionStatuses.connected) {
      nextConfig.connectedAt = checkedAt;
    }

    return nextConfig;
  } catch {
    return {
      apiKey,
      checkedAt,
      domain,
      reverb: unverifiedReverb,
      status: connectionStatuses.failed,
    };
  }
}

export async function connectAndSaveConnectionConfig(config, options = {}) {
  const verifiedConfig = await verifyConnection(config, options);

  return saveConnectionConfig(
    verifiedConfig,
    options.storage ?? getExtensionStorage(),
  );
}

export function buildReverbWebSocketUrl(reverb) {
  const host = String(reverb?.host ?? '').trim();
  const key = String(reverb?.key ?? '').trim();

  if (host === '' || key === '') {
    return null;
  }

  const scheme = ['https', 'wss'].includes(String(reverb?.scheme ?? '').toLowerCase())
    ? 'wss'
    : 'ws';

  try {
    const url = new URL(`${scheme}://${host}/app/${encodeURIComponent(key)}`);
    const port = Number(reverb?.port);

    if (Number.isInteger(port) && port > 0) {
      url.port = String(port);
    }

    url.searchParams.set('protocol', '7');
    url.searchParams.set('client', 'atlas-extension');
    url.searchParams.set('version', '0.1.0');
    url.searchParams.set('flash', 'false');

    return url.toString();
  } catch {
    return null;
  }
}

export async function verifyReverbConnection(reverb, options = {}) {
  const checkedAt = typeof options.checkedAt === 'string'
    ? options.checkedAt
    : new Date().toISOString();
  const summary = summarizeReverb(reverb, checkedAt);

  if (reverb?.enabled === false) {
    return {
      ...summary,
      status: reverbStatuses.disabled,
    };
  }

  const WebSocketImpl = options.WebSocketImpl ?? globalThis.WebSocket;
  const url = buildReverbWebSocketUrl(reverb);

  if (url === null || typeof WebSocketImpl !== 'function') {
    return {
      ...summary,
      status: reverbStatuses.failed,
    };
  }

  return new Promise((resolve) => {
    let settled = false;
    let timeoutId = null;
    let socket = null;

    const finish = (status) => {
      if (settled) {
        return;
      }

      settled = true;

      if (timeoutId !== null) {
        globalThis.clearTimeout(timeoutId);
      }

      closeSocket(socket);
      resolve({
        ...summary,
        status,
      });
    };

    try {
      socket = new WebSocketImpl(url);
    } catch {
      finish(reverbStatuses.failed);

      return;
    }

    socket.addEventListener('message', (event) => {
      const message = parseJson(event?.data);

      if (message?.event === 'pusher:connection_established') {
        finish(reverbStatuses.connected);
      }
    });
    socket.addEventListener('error', () => finish(reverbStatuses.failed));
    socket.addEventListener('close', () => finish(reverbStatuses.failed));

    timeoutId = globalThis.setTimeout(
      () => finish(reverbStatuses.failed),
      typeof options.timeoutMs === 'number' ? options.timeoutMs : 3000,
    );
  });
}

function isConnectionStatus(value) {
  return Object.values(connectionStatuses).includes(value);
}

function isReverbStatus(value) {
  return Object.values(reverbStatuses).includes(value);
}

function isReverbAcceptable(status) {
  return [reverbStatuses.connected, reverbStatuses.disabled, reverbStatuses.idle].includes(status);
}

function normalizeReverbState(reverb) {
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

function summarizeReverb(reverb, checkedAt) {
  const summary = {
    checkedAt,
  };

  for (const key of ['channel', 'enabled', 'host', 'key', 'port', 'scheme']) {
    if (reverb?.[key] !== undefined && reverb[key] !== null) {
      summary[key] = reverb[key];
    }
  }

  return summary;
}

async function readJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function parseJson(value) {
  try {
    return JSON.parse(String(value ?? ''));
  } catch {
    return null;
  }
}

function closeSocket(socket) {
  try {
    socket?.close?.();
  } catch {
    // Ignore close errors; this is a one-shot connectivity check.
  }
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
