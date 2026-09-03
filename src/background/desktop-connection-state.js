import {
  desktopBaseForChannel,
  desktopProtocolVersion,
  resolveExtensionChannel,
  serializeDesktopError,
} from '../shared/desktop-contract.js';
import {
  desktopConnectionStorageKey,
  normalizeDesktopCapabilities,
} from '../shared/desktop-capabilities.js';

export { desktopConnectionStorageKey } from '../shared/desktop-capabilities.js';

const desktopConnectionStorageVersion = 3;
const pendingStorageWrites = new WeakMap();

export function createDefaultDesktopConnectionState(channel = resolveExtensionChannel()) {
  return {
    app: null,
    capabilities: [],
    channel,
    clientId: '',
    clientToken: '',
    eventSequence: 0,
    eventStatus: 'disconnected',
    eventConnectedAt: null,
    health: 'offline',
    lastCheckedAt: null,
    lastEventAt: null,
    lastHeartbeatAt: null,
    lastError: null,
    pairingPending: false,
    reconnectAttempt: 0,
    protocolVersion: desktopProtocolVersion,
    runtimePolicyRevision: null,
    version: desktopConnectionStorageVersion,
  };
}

export async function loadDesktopConnectionState(storage = getExtensionStorage()) {
  const fallback = createDefaultDesktopConnectionState();

  if (typeof storage?.get !== 'function') {
    return fallback;
  }

  try {
    const result = await storage.get(desktopConnectionStorageKey);
    return normalizeDesktopConnectionState(result?.[desktopConnectionStorageKey]);
  } catch {
    return fallback;
  }
}

export async function saveDesktopConnectionState(state, storage = getExtensionStorage()) {
  if (typeof storage?.set !== 'function') {
    throw new Error('Extension storage is unavailable.');
  }

  const normalized = normalizeDesktopConnectionState(state);
  await storage.set({ [desktopConnectionStorageKey]: normalized });
  return normalized;
}

export async function patchDesktopConnectionState(patch, storage = getExtensionStorage()) {
  if (!storage) throw new Error('Extension storage is unavailable.');
  // Event callbacks and explicit connection actions share this record. Serialize
  // read/modify/write operations so a late heartbeat cannot restore old credentials.
  const previous = pendingStorageWrites.get(storage) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    const current = await loadDesktopConnectionState(storage);
    return saveDesktopConnectionState({ ...current, ...patch }, storage);
  });
  pendingStorageWrites.set(storage, next);
  try {
    return await next;
  } finally {
    if (pendingStorageWrites.get(storage) === next) pendingStorageWrites.delete(storage);
  }
}

export async function clearDesktopClientCredentials(storage = getExtensionStorage()) {
  return patchDesktopConnectionState({
    clientId: '',
    clientToken: '',
    eventSequence: 0,
    eventStatus: 'disconnected',
    eventConnectedAt: null,
    lastEventAt: null,
    lastHeartbeatAt: null,
    lastError: null,
    reconnectAttempt: 0,
    runtimePolicyRevision: null,
    health: 'unpaired',
    pairingPending: false,
  }, storage);
}

export function hasDesktopClientCredentials(state) {
  return String(state?.clientId ?? '').trim() !== ''
    && String(state?.clientToken ?? '').trim() !== ''
    && state?.channel === resolveExtensionChannel();
}

export function publicDesktopDiagnostics(state, runtime = globalThis.chrome?.runtime) {
  const normalized = normalizeDesktopConnectionState(state);

  return {
    app: normalized.app,
    capabilities: normalized.capabilities,
    baseUrl: desktopBaseForChannel(normalized.channel),
    channel: normalized.channel,
    clientId: normalized.clientId || null,
    eventSequence: normalized.eventSequence,
    eventStatus: normalized.eventStatus,
    eventConnectedAt: normalized.eventConnectedAt,
    extensionVersion: runtime?.getManifest?.()?.version ?? 'unknown',
    health: normalized.health,
    lastCheckedAt: normalized.lastCheckedAt,
    lastEventAt: normalized.lastEventAt,
    lastHeartbeatAt: normalized.lastHeartbeatAt,
    lastError: normalized.lastError,
    paired: hasDesktopClientCredentials(normalized),
    pairingPending: normalized.pairingPending,
    protocolVersion: normalized.protocolVersion,
    reconnectAttempt: normalized.reconnectAttempt,
    runtimePolicyRevision: normalized.runtimePolicyRevision,
  };
}

export function desktopErrorState(error, health = 'error') {
  return {
    health,
    lastCheckedAt: new Date().toISOString(),
    lastError: serializeDesktopError(error),
  };
}

export function normalizeDesktopConnectionState(value) {
  const fallback = createDefaultDesktopConnectionState();
  const channel = resolveExtensionChannel();
  const channelMatchesBuild = value?.channel === channel;

  return {
    app: normalizeApp(value?.app),
    capabilities: normalizeDesktopCapabilities(value?.capabilities),
    channel,
    clientId: channelMatchesBuild ? stringValue(value?.clientId) : '',
    clientToken: channelMatchesBuild ? stringValue(value?.clientToken) : '',
    eventSequence: nonNegativeInteger(value?.eventSequence),
    eventStatus: ['connected', 'connecting', 'disconnected', 'error'].includes(value?.eventStatus)
      ? value.eventStatus
      : fallback.eventStatus,
    eventConnectedAt: nullableString(value?.eventConnectedAt),
    health: ['connected', 'error', 'offline', 'unpaired'].includes(value?.health)
      ? value.health
      : fallback.health,
    lastCheckedAt: nullableString(value?.lastCheckedAt),
    lastEventAt: nullableString(value?.lastEventAt),
    lastHeartbeatAt: nullableString(value?.lastHeartbeatAt),
    lastError: normalizeError(value?.lastError),
    pairingPending: value?.pairingPending === true,
    reconnectAttempt: nonNegativeInteger(value?.reconnectAttempt),
    protocolVersion: desktopProtocolVersion,
    runtimePolicyRevision: Number.isInteger(value?.runtimePolicyRevision)
      ? value.runtimePolicyRevision
      : null,
    version: desktopConnectionStorageVersion,
  };
}

function normalizeApp(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  return {
    channel: nullableString(value.channel),
    version: nullableString(value.version),
  };
}

function normalizeError(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  return {
    code: stringValue(value.code) || 'DESKTOP_REQUEST_FAILED',
    message: stringValue(value.message) || 'Atlas Desktop request failed.',
    retryable: value.retryable === true,
  };
}

function nullableString(value) {
  const normalized = stringValue(value);
  return normalized === '' ? null : normalized;
}

function stringValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function nonNegativeInteger(value) {
  const normalized = Number(value);
  return Number.isInteger(normalized) && normalized >= 0 ? normalized : 0;
}

function getExtensionStorage() {
  return globalThis.chrome?.storage?.local ?? null;
}
