import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('uses the worker-safe pusher entrypoint for the extension background service worker', async () => {
  const source = await readFile(new URL('../src/background/pusher-reverb-client.js', import.meta.url), 'utf8');

  assert.match(source, /from 'pusher-js\/worker\/index\.js'/);
});

class FakePusher {
  static instances = [];

  constructor(key, options) {
    this.channels = new Map();
    this.connection = {
      bind: () => {},
      state: 'initialized',
      unbind: () => {},
    };
    this.disconnected = false;
    this.key = key;
    this.options = options;

    FakePusher.instances.push(this);
  }

  subscribe(channelName) {
    const channel = new FakeChannel(channelName);

    this.channels.set(channelName, channel);

    return channel;
  }

  disconnect() {
    this.disconnected = true;
  }
}

class FakeChannel {
  constructor(name) {
    this.handlers = new Map();
    this.name = name;
    this.unbound = false;
  }

  bind(eventName, callback) {
    this.handlers.set(eventName, callback);
  }

  emit(eventName, payload) {
    this.handlers.get(eventName)?.(payload);
  }

  unbind_all() {
    this.unbound = true;
  }
}

test('creates pusher reverb client with private channel auth and relays download events', async () => {
  const { createPusherReverbClient } = await importBackgroundPusherReverbClient();

  FakePusher.instances = [];
  const authRequests = [];
  const client = await createPusherReverbClient({
    apiKey: 'extension-key',
    domain: 'https://atlas.test',
    reverb: {
      channel: 'private-extension-downloads.abc123',
      enabled: true,
      host: 'atlas.test',
      key: 'reverb-key',
      port: 8080,
      scheme: 'https',
    },
  }, {
    PusherImpl: FakePusher,
    fetchImpl: async (url, options) => {
      authRequests.push({ options, url });

      return {
        json: async () => ({ auth: 'reverb-key:test-signature' }),
        ok: true,
      };
    },
  });

  assert.notEqual(client, null);
  assert.equal(FakePusher.instances.length, 1);
  assert.equal(FakePusher.instances[0].key, 'reverb-key');
  assert.equal(FakePusher.instances[0].options.wsHost, 'atlas.test');
  assert.equal(FakePusher.instances[0].options.forceTLS, true);

  const authHandler = FakePusher.instances[0].options.channelAuthorization.customHandler;
  const authPayload = await new Promise((resolve, reject) => {
    authHandler({
      channelName: 'private-extension-downloads.abc123',
      socketId: '123.456',
    }, (error, payload) => {
      if (error !== null) {
        reject(error);

        return;
      }

      resolve(payload);
    });
  });

  assert.deepEqual(authPayload, { auth: 'reverb-key:test-signature' });
  assert.equal(authRequests[0].url, 'https://atlas.test/api/extension/broadcasting/auth');
  assert.equal(authRequests[0].options.headers['X-Atlas-Api-Key'], 'extension-key');
  assert.equal(JSON.parse(authRequests[0].options.body).socket_id, '123.456');

  const events = [];

  client.onEvent((payload) => {
    events.push(payload);
  });

  FakePusher.instances[0].channels
    .get('private-extension-downloads.abc123')
    .emit('DownloadTransferProgressUpdated', {
      asset_url: 'https://cdn.example.test/media/art.jpg',
      file: {
        atlas_url: 'https://atlas.test/browse/file/123',
        id: 123,
      },
      percent: 42,
      reaction: 'like',
      status: 'downloading',
    });

  assert.deepEqual(events, [{
    assetUrl: 'https://cdn.example.test/media/art.jpg',
    download: {
      downloaded_at: null,
      file_id: null,
      progress_percent: 42,
      status: 'downloading',
    },
    file: {
      atlas_url: 'https://atlas.test/browse/file/123',
      id: 123,
    },
    reaction: { type: 'like' },
  }]);

  client.disconnect();
  assert.equal(FakePusher.instances[0].disconnected, true);
  assert.equal(FakePusher.instances[0].channels.get('private-extension-downloads.abc123').unbound, true);
});

async function importBackgroundPusherReverbClient() {
  globalThis.self ??= globalThis;

  return import('../src/background/pusher-reverb-client.js');
}
