import { createDesktopContractError } from '../shared/desktop-contract.js';

const reconnectDelaysMs = [1000, 2500, 5000, 10000, 30000];
const downloadEventTypes = new Set([
  'download.created',
  'download.progress',
  'download.queued',
]);

export function createDesktopEventClient({
  credentials,
  getSequence,
  onEvent,
  onPolicyChanged,
  onResyncRequired,
  onSequence,
  onStatus,
  transport,
  WebSocketImpl = globalThis.WebSocket,
}) {
  let stopped = true;
  let socket = null;
  let reconnectAttempt = 0;
  let reconnectTimer = null;
  let connectionGeneration = 0;

  async function start() {
    stopped = false;
    reconnectAttempt = 0;
    connectionGeneration += 1;
    await connect(connectionGeneration);
  }

  function stop() {
    stopped = true;
    connectionGeneration += 1;
    clearReconnectTimer();
    closeSocket();
    onStatus?.('disconnected');
  }

  async function reconnect() {
    stop();
    await start();
  }

  async function connect(generation) {
    if (stopped || generation !== connectionGeneration) {
      return;
    }

    onStatus?.('connecting');

    try {
      const sequence = normalizeSequence(await getSequence?.());
      const ticket = await transport.eventTicket(credentials, sequence);

      if (stopped || generation !== connectionGeneration) {
        return;
      }

      const websocketUrl = validateWebSocketUrl(ticket?.websocket_url, transport.baseUrl);

      if (typeof WebSocketImpl !== 'function') {
        throw createDesktopContractError('EVENTS_UNAVAILABLE', 'Desktop event connection is unavailable.', true);
      }

      socket = new WebSocketImpl(websocketUrl);
      bindSocket(socket, generation);
    } catch (error) {
      onStatus?.('error', error);
      scheduleReconnect(generation);
    }
  }

  function bindSocket(activeSocket, generation) {
    activeSocket.addEventListener('open', () => {
      if (activeSocket !== socket || generation !== connectionGeneration) {
        return;
      }

      reconnectAttempt = 0;
      onStatus?.('connected');
    });
    activeSocket.addEventListener('message', (event) => {
      if (activeSocket === socket && generation === connectionGeneration) {
        handleFrame(parseFrame(event?.data), generation);
      }
    });
    activeSocket.addEventListener('error', () => {
      if (activeSocket === socket) {
        onStatus?.('error', createDesktopContractError(
          'EVENT_CONNECTION_FAILED',
          'Atlas Desktop event connection failed.',
          true,
        ));
      }
    });
    activeSocket.addEventListener('close', () => {
      if (activeSocket !== socket || generation !== connectionGeneration) {
        return;
      }

      socket = null;
      onStatus?.('disconnected');
      scheduleReconnect(generation);
    });
  }

  function handleFrame(frame, generation) {
    if (frame === null) {
      return;
    }

    const sequence = normalizeSequence(frame.sequence);

    if (frame.type === 'ready') {
      onSequence?.(sequence);
      return;
    }

    if (frame.type === 'resync_required') {
      onSequence?.(0);
      onResyncRequired?.();
      closeSocket();
      scheduleReconnect(generation);
      return;
    }

    if (frame.type === 'runtime.policy.changed') {
      onSequence?.(sequence);
      onPolicyChanged?.(frame.data);
      return;
    }

    if (!downloadEventTypes.has(frame.type) || !frame.data || typeof frame.data !== 'object') {
      return;
    }

    onSequence?.(sequence);
    onEvent?.({
      ...frame.data,
      eventSequence: sequence,
      eventType: frame.type,
      occurredAt: typeof frame.occurred_at === 'string' ? frame.occurred_at : null,
    });
  }

  function scheduleReconnect(generation) {
    if (stopped || reconnectTimer !== null || generation !== connectionGeneration) {
      return;
    }

    const delay = reconnectDelaysMs[Math.min(reconnectAttempt, reconnectDelaysMs.length - 1)];
    reconnectAttempt += 1;
    reconnectTimer = globalThis.setTimeout(() => {
      reconnectTimer = null;
      void connect(generation);
    }, delay);
  }

  function clearReconnectTimer() {
    if (reconnectTimer !== null) {
      globalThis.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function closeSocket() {
    const activeSocket = socket;
    socket = null;

    try {
      activeSocket?.close?.();
    } catch {
      // The connection may already be closing while the MV3 worker is suspending.
    }
  }

  return { reconnect, start, stop };
}

export function validateWebSocketUrl(value, baseUrl) {
  let websocketUrl;
  let expectedBase;

  try {
    websocketUrl = new URL(value);
    expectedBase = new URL(baseUrl);
  } catch {
    throw createDesktopContractError('INVALID_EVENT_URL', 'Atlas Desktop returned an invalid event URL.', false);
  }

  const expectedProtocol = expectedBase.protocol === 'https:' ? 'wss:' : 'ws:';

  if (
    websocketUrl.protocol !== expectedProtocol
    || websocketUrl.hostname !== expectedBase.hostname
    || websocketUrl.port !== expectedBase.port
    || websocketUrl.pathname !== '/v1/events'
  ) {
    throw createDesktopContractError('INVALID_EVENT_URL', 'Atlas Desktop returned an unexpected event URL.', false);
  }

  return websocketUrl.href;
}

function parseFrame(value) {
  try {
    const frame = JSON.parse(String(value ?? ''));
    return frame && typeof frame === 'object' ? frame : null;
  } catch {
    return null;
  }
}

function normalizeSequence(value) {
  const sequence = Number(value);
  return Number.isInteger(sequence) && sequence >= 0 ? sequence : 0;
}
