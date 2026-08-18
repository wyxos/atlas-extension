import {
  createDesktopContractError,
  desktopMessageTypes,
  serializeDesktopError,
} from '../shared/desktop-contract.js';
import {
  clearDesktopClientCredentials,
  desktopErrorState,
  hasDesktopClientCredentials,
  loadDesktopConnectionState,
  patchDesktopConnectionState,
  publicDesktopDiagnostics,
  saveDesktopConnectionState,
} from './desktop-connection-state.js';
import { createDesktopEventClient } from './desktop-event-client.js';
import { syncDesktopRuntimePolicy } from './desktop-runtime-policy.js';
import { createDesktopTransport } from './desktop-transport.js';

export function createDesktopRuntime(options = {}) {
  const storage = options.storage ?? globalThis.chrome?.storage?.local;
  const runtime = options.runtime ?? globalThis.chrome?.runtime;
  const transport = options.transport ?? createDesktopTransport({ runtime });
  let eventClient = null;
  let pairingController = null;

  async function initialize() {
    try {
      return await reconnect();
    } catch {
      return diagnostics();
    }
  }

  async function reconnect() {
    stopEventClient();

    try {
      const hello = await transport.hello();
      let state = await patchDesktopConnectionState({
        app: hello.app,
        channel: transport.channel,
        health: 'unpaired',
        lastCheckedAt: new Date().toISOString(),
        lastError: null,
        protocolVersion: hello.protocol_version,
      }, storage);

      if (!hasDesktopClientCredentials(state)) {
        return publicDesktopDiagnostics(state, runtime);
      }

      await syncDesktopRuntimePolicy({ credentials: state, storage, transport });
      state = await patchDesktopConnectionState({
        health: 'connected',
        lastCheckedAt: new Date().toISOString(),
        lastError: null,
      }, storage);
      await startEventClient(state);
      return publicDesktopDiagnostics(await loadDesktopConnectionState(storage), runtime);
    } catch (error) {
      if (isRevokedCredentialError(error)) {
        await clearDesktopClientCredentials(storage);
      }

      await patchDesktopConnectionState(desktopErrorState(
        error,
        error?.code === 'DESKTOP_OFFLINE' || error?.code === 'DESKTOP_TIMEOUT' ? 'offline' : 'error',
      ), storage);
      throw error;
    }
  }

  async function pair() {
    if (pairingController !== null) {
      throw createDesktopContractError('PAIRING_PENDING', 'A Desktop pairing request is already pending.', true);
    }

    pairingController = new globalThis.AbortController();
    await patchDesktopConnectionState({ pairingPending: true }, storage);

    try {
      const result = await transport.pair({ signal: pairingController.signal });
      const clientId = String(result?.client_id ?? '').trim();
      const clientToken = String(result?.client_token ?? '').trim();

      if (clientId === '' || clientToken === '') {
        throw createDesktopContractError('INVALID_PAIRING_RESPONSE', 'Atlas Desktop returned invalid pairing credentials.', false);
      }

      await saveDesktopConnectionState({
        ...(await loadDesktopConnectionState(storage)),
        channel: transport.channel,
        clientId,
        clientToken,
        health: 'connected',
        lastCheckedAt: new Date().toISOString(),
        lastError: null,
        pairingPending: false,
      }, storage);

      return reconnect();
    } catch (error) {
      await patchDesktopConnectionState({
        ...desktopErrorState(error, error?.code === 'DESKTOP_OFFLINE' ? 'offline' : 'error'),
        pairingPending: false,
      }, storage);
      throw error;
    } finally {
      pairingController = null;
    }
  }

  async function cancelPairing() {
    if (pairingController === null) {
      return diagnostics();
    }

    pairingController.abort(createDesktopContractError(
      'PAIRING_CANCELLED',
      'Desktop pairing was cancelled.',
      true,
    ));
    await patchDesktopConnectionState({ pairingPending: false }, storage);
    return diagnostics();
  }

  async function unpair() {
    const state = await loadDesktopConnectionState(storage);

    if (hasDesktopClientCredentials(state)) {
      await transport.unpair(state);
    }

    stopEventClient();
    const nextState = await clearDesktopClientCredentials(storage);
    return publicDesktopDiagnostics(nextState, runtime);
  }

  async function diagnostics() {
    return publicDesktopDiagnostics(await loadDesktopConnectionState(storage), runtime);
  }

  async function requestContext() {
    const credentials = await loadDesktopConnectionState(storage);

    if (!hasDesktopClientCredentials(credentials)) {
      throw createDesktopContractError('PAIRING_REQUIRED', 'Pair this extension with Atlas Desktop first.', false);
    }

    return { credentials, transport };
  }

  async function openFile(fileId) {
    const { credentials } = await requestContext();
    return transport.openFile(credentials, fileId);
  }

  function handleMessage(message, sendResponse) {
    const handlers = {
      [desktopMessageTypes.cancelPairing]: cancelPairing,
      [desktopMessageTypes.diagnostics]: diagnostics,
      [desktopMessageTypes.openFile]: () => openFile(message.fileId),
      [desktopMessageTypes.pair]: pair,
      [desktopMessageTypes.reconnect]: reconnect,
      [desktopMessageTypes.unpair]: unpair,
    };
    const handler = handlers[message?.type];

    if (handler === undefined) {
      return false;
    }

    void handler()
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => sendResponse({ ok: false, error: serializeDesktopError(error) }));

    return true;
  }

  async function startEventClient(credentials) {
    eventClient = createDesktopEventClient({
      credentials,
      getSequence: async () => (await loadDesktopConnectionState(storage)).eventSequence,
      onEvent: options.onDownloadEvent,
      onPolicyChanged: () => {
        void syncDesktopRuntimePolicy({ credentials, storage, transport }).catch((error) => {
          void patchDesktopConnectionState({ lastError: serializeDesktopError(error) }, storage);
        });
      },
      onResyncRequired: () => {
        options.onResyncRequired?.();
      },
      onSequence: (eventSequence) => {
        void patchDesktopConnectionState({ eventSequence }, storage);
      },
      onStatus: (eventStatus, error) => {
        void patchDesktopConnectionState({
          eventStatus,
          ...(error ? { lastError: serializeDesktopError(error) } : {}),
        }, storage);
      },
      transport,
      WebSocketImpl: options.WebSocketImpl,
    });
    await eventClient.start();
  }

  function stopEventClient() {
    eventClient?.stop();
    eventClient = null;
  }

  return {
    cancelPairing,
    diagnostics,
    handleMessage,
    initialize,
    openFile,
    pair,
    reconnect,
    requestContext,
    unpair,
  };
}

function isRevokedCredentialError(error) {
  return ['CLIENT_REVOKED', 'INVALID_CLIENT', 'UNAUTHORIZED'].includes(error?.code);
}
