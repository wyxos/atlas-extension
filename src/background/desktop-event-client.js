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
  onCheckpoint,
  onEvent,
  onHeartbeat,
  onPolicyChanged,
  onReconnectAttempt,
  onResyncRequired,
  onStatus,
  transport,
  clearIntervalImpl = globalThis.clearInterval,
  heartbeatIntervalMs = 20_000,
  now = () => new Date().toISOString(),
  setIntervalImpl = globalThis.setInterval,
  WebSocketImpl = globalThis.WebSocket,
}) {
  let stopped = true;
  let socket = null;
  let reconnectAttempt = 0;
  let reconnectTimer = null;
  let heartbeatTimer = null;
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
      startHeartbeat(activeSocket, generation);
    });
    activeSocket.addEventListener('message', (event) => {
      if (activeSocket === socket && generation === connectionGeneration) {
        handleFrame(parseFrame(event?.data), generation, now());
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

      clearHeartbeatTimer();
      socket = null;
      onStatus?.('disconnected');
      scheduleReconnect(generation);
    });
  }

  function handleFrame(frame, generation, receivedAt) {
    if (frame === null) {
      onCheckpoint?.({ lastEventAt: receivedAt });
      return;
    }

    const sequence = normalizeSequence(frame.sequence);

    if (frame.type === 'ready') {
      onCheckpoint?.({ eventSequence: sequence, lastEventAt: receivedAt });
      return;
    }

    if (frame.type === 'resync_required') {
      onCheckpoint?.({ eventSequence: 0, lastEventAt: receivedAt });
      onResyncRequired?.();
      closeSocket();
      scheduleReconnect(generation);
      return;
    }

    if (frame.type === 'runtime.policy.changed') {
      onCheckpoint?.({ eventSequence: sequence, lastEventAt: receivedAt });
      onPolicyChanged?.(frame.data);
      return;
    }

    if (!downloadEventTypes.has(frame.type) || !frame.data || typeof frame.data !== 'object') {
      onCheckpoint?.({ lastEventAt: receivedAt });
      return;
    }

    onCheckpoint?.({ eventSequence: sequence, lastEventAt: receivedAt });
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
    onReconnectAttempt?.(reconnectAttempt);
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

  function startHeartbeat(activeSocket, generation) {
    clearHeartbeatTimer();
    heartbeatTimer = setIntervalImpl(() => {
      if (
        stopped
        || activeSocket !== socket
        || generation !== connectionGeneration
        || (typeof activeSocket.readyState === 'number' && activeSocket.readyState !== 1)
      ) {
        return;
      }

      try {
        activeSocket.send(JSON.stringify({ type: 'keepalive' }));
        onHeartbeat?.(now());
      } catch {
        closeSocket();
        onStatus?.('disconnected');
        scheduleReconnect(generation);
      }
    }, heartbeatIntervalMs);
  }

  function clearHeartbeatTimer() {
    if (heartbeatTimer !== null) {
      clearIntervalImpl(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function closeSocket() {
    clearHeartbeatTimer();
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
