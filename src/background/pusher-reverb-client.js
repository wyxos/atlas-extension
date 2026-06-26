import Pusher from 'pusher-js/worker/index.js';

import { normalizeDownloadEventPayload } from './reverb-client.js';

const downloadEventNames = [
  'DownloadTransferCreated',
  'DownloadTransferProgressUpdated',
  'DownloadTransferQueued',
];

export async function createPusherReverbClient(config, options = {}) {
  const reverb = config?.reverb;
  const PusherImpl = options.PusherImpl ?? Pusher;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  if (!isUsableConfig(config) || typeof PusherImpl !== 'function' || typeof fetchImpl !== 'function') {
    return null;
  }

  const pusher = new PusherImpl(reverb.key, {
    channelAuthorization: {
      customHandler: (params, callback) => {
        void authorizePrivateChannel({
          callback,
          channelName: params.channelName ?? reverb.channel,
          config,
          fetchImpl,
          socketId: params.socketId ?? '',
        });
      },
      endpoint: `${config.domain}/api/extension/broadcasting/auth`,
      transport: 'ajax',
    },
    cluster: 'mt1',
    disableStats: true,
    enabledTransports: ['ws', 'wss'],
    forceTLS: ['https', 'wss'].includes(String(reverb.scheme ?? '').toLowerCase()),
    wsHost: reverb.host,
    wsPort: reverb.port,
    wssPort: reverb.port,
  });
  const channel = pusher.subscribe(reverb.channel);
  const callbacks = new Set();

  for (const eventName of downloadEventNames) {
    channel.bind(eventName, (payload) => {
      const normalized = normalizeDownloadEventPayload({
        data: payload,
        event: eventName,
      });

      if (normalized === null) {
        return;
      }

      for (const callback of callbacks) {
        callback(normalized);
      }
    });
  }

  return {
    disconnect: () => {
      callbacks.clear();
      channel.unbind_all?.();
      pusher.disconnect?.();
    },
    onEvent: (callback) => {
      callbacks.add(callback);

      return {
        unsubscribe: () => {
          callbacks.delete(callback);
        },
      };
    },
  };
}

async function authorizePrivateChannel({
  callback,
  channelName,
  config,
  fetchImpl,
  socketId,
}) {
  try {
    const response = await fetchImpl(`${config.domain}/api/extension/broadcasting/auth`, {
      body: JSON.stringify({
        channel_name: channelName,
        socket_id: socketId,
      }),
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Atlas-Api-Key': config.apiKey,
      },
      method: 'POST',
    });
    const payload = await response.json();

    callback(response.ok ? null : new Error(`Private Reverb channel auth failed with status ${response.status}.`), payload);
  } catch (error) {
    callback(error instanceof Error ? error : new Error('Private Reverb channel auth failed.'), null);
  }
}

function isUsableConfig(config) {
  const reverb = config?.reverb;

  return Boolean(
    reverb?.enabled
      && config?.domain
      && config?.apiKey
      && reverb.channel
      && reverb.host
      && reverb.key,
  );
}
