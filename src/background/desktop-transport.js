import {
  assertDesktopChannel,
  assertDesktopProtocol,
  createDesktopContractError,
  desktopBaseForChannel,
  resolveExtensionChannel,
} from '../shared/desktop-contract.js';
import { hasDesktopClientCredentials } from './desktop-connection-state.js';

const defaultRequestTimeoutMs = 15000;
const pairingRequestTimeoutMs = 5 * 60 * 1000;

export function createDesktopTransport(options = {}) {
  const channel = resolveExtensionChannel(options.channel);
  const baseUrl = options.baseUrl ?? desktopBaseForChannel(channel);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const runtime = options.runtime ?? globalThis.chrome?.runtime;

  async function hello(requestOptions = {}) {
    const data = await request('/v1/hello', {
      ...requestOptions,
      authenticated: false,
      method: 'GET',
    });

    assertDesktopChannel(data, channel);
    assertDesktopProtocol(data);
    return data;
  }

  async function pair(requestOptions = {}) {
    await hello({ signal: requestOptions.signal });

    return request('/v1/pairings', {
      authenticated: false,
      body: {
        browser: detectBrowser(),
        client_name: 'Atlas Extension',
        expected_channel: channel,
        extension_origin: resolveExtensionOrigin(runtime),
        extension_version: runtime?.getManifest?.()?.version ?? 'unknown',
      },
      method: 'POST',
      signal: requestOptions.signal,
      timeoutMs: requestOptions.timeoutMs ?? pairingRequestTimeoutMs,
    });
  }

  async function unpair(credentials, requestOptions = {}) {
    requireCredentials(credentials);
    return request(`/v1/pairings/${encodeURIComponent(credentials.clientId)}`, {
      ...requestOptions,
      credentials,
      method: 'DELETE',
      mutation: true,
    });
  }

  function runtimePolicy(credentials, requestOptions = {}) {
    return request('/v1/runtime-policy', {
      ...requestOptions,
      credentials,
      method: 'GET',
    });
  }

  function assetStatuses(credentials, body, requestOptions = {}) {
    return request('/v1/assets/status', {
      ...requestOptions,
      body,
      credentials,
      method: 'POST',
    });
  }

  function reaction(credentials, body, requestOptions = {}) {
    return request('/v1/reactions', {
      ...requestOptions,
      body,
      credentials,
      method: 'POST',
      mutation: true,
    });
  }

  function reactionBatch(credentials, body, requestOptions = {}) {
    return request('/v1/reactions/batch', {
      ...requestOptions,
      body,
      credentials,
      method: 'POST',
      mutation: true,
    });
  }

  function deleteFile(credentials, fileId, requestOptions = {}) {
    return request(`/v1/files/${normalizeFileId(fileId)}`, {
      ...requestOptions,
      body: {
        also_delete_record: true,
        also_from_disk: true,
      },
      credentials,
      method: 'DELETE',
      mutation: true,
    });
  }

  function openFile(credentials, fileId, requestOptions = {}) {
    return request(`/v1/files/${normalizeFileId(fileId)}/open`, {
      ...requestOptions,
      credentials,
      method: 'POST',
      mutation: true,
    });
  }

  function applyAssetMatchRule(credentials, body, requestOptions = {}) {
    return request('/v1/asset-match-rules/apply', {
      ...requestOptions,
      body,
      credentials,
      method: 'POST',
      mutation: true,
    });
  }

  function eventTicket(credentials, afterSequence, requestOptions = {}) {
    return request('/v1/events/tickets', {
      ...requestOptions,
      body: { after_sequence: normalizeSequence(afterSequence) },
      credentials,
      method: 'POST',
      mutation: true,
    });
  }

  async function request(path, requestOptions = {}) {
    if (typeof fetchImpl !== 'function') {
      throw createDesktopContractError('DESKTOP_OFFLINE', 'Atlas Desktop is not reachable.', true);
    }

    const authenticated = requestOptions.authenticated !== false;
    const credentials = requestOptions.credentials;

    if (authenticated) {
      requireCredentials(credentials);
    }

    const controller = typeof globalThis.AbortController === 'function'
      ? new globalThis.AbortController()
      : null;
    const timeoutMs = requestOptions.timeoutMs ?? defaultRequestTimeoutMs;
    const timeoutId = controller === null ? null : globalThis.setTimeout(() => {
      controller.abort(createDesktopContractError('DESKTOP_TIMEOUT', 'Atlas Desktop did not respond in time.', true));
    }, timeoutMs);
    const signal = combineAbortSignals(controller?.signal, requestOptions.signal);

    try {
      const response = await fetchImpl(`${baseUrl}${path}`, {
        ...(requestOptions.body === undefined ? {} : { body: JSON.stringify(requestOptions.body) }),
        headers: buildHeaders({
          body: requestOptions.body,
          credentials,
          idempotencyKey: requestOptions.mutation === true
            ? requestOptions.idempotencyKey ?? randomId()
            : null,
        }),
        method: requestOptions.method ?? 'GET',
        signal,
      });
      const envelope = await readEnvelope(response);

      if (!response.ok || envelope.ok !== true) {
        throw errorFromEnvelope(envelope, response.status);
      }

      return envelope.data ?? {};
    } catch (error) {
      if (error?.code) {
        throw error;
      }

      if (signal?.aborted) {
        const reason = signal.reason;
        throw reason?.code
          ? reason
          : createDesktopContractError('REQUEST_CANCELLED', 'Atlas Desktop request was cancelled.', true);
      }

      throw createDesktopContractError('DESKTOP_OFFLINE', 'Atlas Desktop is not reachable.', true);
    } finally {
      if (timeoutId !== null) {
        globalThis.clearTimeout(timeoutId);
      }
    }
  }

  return {
    applyAssetMatchRule,
    assetStatuses,
    baseUrl,
    channel,
    deleteFile,
    eventTicket,
    hello,
    openFile,
    pair,
    reaction,
    reactionBatch,
    request,
    runtimePolicy,
    unpair,
  };
}

function buildHeaders({ body, credentials, idempotencyKey }) {
  return {
    Accept: 'application/json',
    ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    ...(credentials ? {
      Authorization: `Bearer ${credentials.clientToken}`,
      'X-Atlas-Client-Id': credentials.clientId,
    } : {}),
    ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
  };
}

function requireCredentials(credentials) {
  if (!hasDesktopClientCredentials(credentials)) {
    throw createDesktopContractError('PAIRING_REQUIRED', 'Pair this extension with Atlas Desktop first.', false);
  }
}

async function readEnvelope(response) {
  let envelope;

  try {
    envelope = await response.json();
  } catch {
    throw createDesktopContractError('INVALID_RESPONSE', 'Atlas Desktop returned an invalid response.', true);
  }

  if (!envelope || typeof envelope !== 'object' || typeof envelope.ok !== 'boolean') {
    throw createDesktopContractError('INVALID_RESPONSE', 'Atlas Desktop returned an invalid response.', true);
  }

  return envelope;
}

function errorFromEnvelope(envelope, status) {
  const error = envelope?.error;
  return createDesktopContractError(
    typeof error?.code === 'string' ? error.code : `HTTP_${status}`,
    typeof error?.message === 'string' ? error.message : 'Atlas Desktop request failed.',
    error?.retryable === true,
    error?.details,
  );
}

function normalizeFileId(value) {
  const fileId = Number(value);

  if (!Number.isInteger(fileId) || fileId <= 0) {
    throw createDesktopContractError('INVALID_FILE_ID', 'Atlas file id is required.', false);
  }

  return fileId;
}

function normalizeSequence(value) {
  const sequence = Number(value);
  return Number.isInteger(sequence) && sequence >= 0 ? sequence : 0;
}

function detectBrowser() {
  const userAgent = String(globalThis.navigator?.userAgent ?? '').toLowerCase();

  if (userAgent.includes('edg/')) {
    return 'edge';
  }

  if (userAgent.includes('chrome/')) {
    return 'chrome';
  }

  return 'chromium';
}

function resolveExtensionOrigin(runtime) {
  let url;

  try {
    url = new URL(runtime?.getURL?.('') ?? '');
  } catch {
    throw createDesktopContractError(
      'INVALID_EXTENSION_IDENTITY',
      'Atlas Extension could not determine its browser identity.',
      false,
    );
  }

  if (
    !['chrome-extension:', 'moz-extension:'].includes(url.protocol)
    || url.hostname === ''
    || url.username !== ''
    || url.password !== ''
    || url.port !== ''
  ) {
    throw createDesktopContractError(
      'INVALID_EXTENSION_IDENTITY',
      'Atlas Extension could not determine its browser identity.',
      false,
    );
  }

  return `${url.protocol}//${url.hostname}`;
}

function randomId() {
  return globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function combineAbortSignals(primary, secondary) {
  if (!primary) {
    return secondary;
  }

  if (!secondary) {
    return primary;
  }

  if (typeof globalThis.AbortSignal?.any === 'function') {
    return globalThis.AbortSignal.any([primary, secondary]);
  }

  return secondary.aborted ? secondary : primary;
}
