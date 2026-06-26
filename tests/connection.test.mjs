import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildReverbWebSocketUrl,
  connectAndSaveConnectionConfig,
  connectionModes,
  connectionStatuses,
  defaultApiKey,
  defaultDomain,
  getReverbStatusVariant,
  getStatusVariant,
  isConnectableConfig,
  loadConnectionConfig,
  localApiKey,
  localDomain,
  normalizeDomain,
  reverbStatuses,
  saveConnectionConfig,
  storageKey,
  verifyConnection,
  verifyReverbConnection,
} from '../src/options/connection.js';

test('normalizes Atlas connection domains', () => {
  assert.equal(defaultDomain, '');
  assert.equal(defaultApiKey, '');
  assert.equal(localDomain, 'https://atlas.test');
  assert.equal(localApiKey, 'atlas_local_development_key');
  assert.equal(normalizeDomain('https://atlas.test/'), 'https://atlas.test');
  assert.equal(normalizeDomain('atlas.test'), 'https://atlas.test');
  assert.equal(normalizeDomain('http://localhost:8000/path'), 'http://localhost:8000');
  assert.equal(normalizeDomain('ftp://atlas.test'), null);
  assert.equal(normalizeDomain(''), null);
});

test('requires a domain and API key before connecting', () => {
  assert.equal(isConnectableConfig({ apiKey: 'abc', domain: 'atlas.test' }), true);
  assert.equal(isConnectableConfig({ apiKey: '', domain: 'atlas.test' }), false);
  assert.equal(isConnectableConfig({ apiKey: 'abc', domain: 'ftp://atlas.test' }), false);
});

test('uses explicit success and danger variants for connection statuses', () => {
  assert.equal(getStatusVariant(connectionStatuses.connected), 'success');
  assert.equal(getStatusVariant(connectionStatuses.failed), 'danger');
  assert.equal(getStatusVariant(connectionStatuses.idle), 'outline');
  assert.equal(getReverbStatusVariant(reverbStatuses.connected), 'success');
  assert.equal(getReverbStatusVariant(reverbStatuses.failed), 'danger');
  assert.equal(getReverbStatusVariant(reverbStatuses.disabled), 'outline');
});

test('saves and loads extension connection settings', async () => {
  const values = {};
  const storage = createStorage(values);
  const savedConfig = await saveConnectionConfig({
    apiKey: ' secret-key ',
    domain: 'atlas.test/',
  }, storage);

  assert.equal(savedConfig.domain, 'https://atlas.test');
  assert.equal(savedConfig.apiKey, 'secret-key');
  assert.equal(savedConfig.mode, connectionModes.live);
  assert.match(savedConfig.connectedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(values[storageKey].mode, connectionModes.live);
  assert.equal(values[storageKey].version, 2);
  assert.deepEqual(values[storageKey].profiles.live, {
    apiKey: 'secret-key',
    connectedAt: savedConfig.connectedAt,
    domain: 'https://atlas.test',
    status: connectionStatuses.connected,
  });
  assert.deepEqual(await loadConnectionConfig(storage), savedConfig);
});

test('verifies a connection with one explicit ping request', async () => {
  const requests = [];
  const result = await verifyConnection({
    apiKey: ' secret-key ',
    domain: 'atlas.test/',
  }, async (url, options) => {
    requests.push({ options, url });

    return {
      ok: true,
      async json() {
        return { ok: true };
      },
    };
  });

  assert.equal(result.status, 'connected');
  assert.equal(result.domain, 'https://atlas.test');
  assert.equal(result.apiKey, 'secret-key');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://atlas.test/api/extension/ping');
  assert.equal(requests[0].options.method, 'GET');
  assert.equal(requests[0].options.headers['X-Atlas-Api-Key'], 'secret-key');
});

test('builds Reverb WebSocket URLs from the Atlas ping payload', () => {
  assert.equal(
    buildReverbWebSocketUrl({
      host: 'reverb-8080.herd.test',
      key: 'laravel-herd',
      port: 443,
      scheme: 'https',
    }),
    'wss://reverb-8080.herd.test/app/laravel-herd?protocol=7&client=atlas-extension&version=0.1.0&flash=false',
  );
  assert.equal(buildReverbWebSocketUrl({ enabled: true, host: '', key: '' }), null);
});

test('confirms Reverb with one transient WebSocket handshake', async () => {
  const sockets = [];
  class FakeWebSocket {
    constructor(url) {
      this.listeners = {};
      this.url = url;
      this.closed = false;
      sockets.push(this);
      queueMicrotask(() => this.emit('message', {
        data: JSON.stringify({ event: 'pusher:connection_established' }),
      }));
    }

    addEventListener(eventName, handler) {
      this.listeners[eventName] = [...(this.listeners[eventName] ?? []), handler];
    }

    close() {
      this.closed = true;
    }

    emit(eventName, event) {
      for (const handler of this.listeners[eventName] ?? []) {
        handler(event);
      }
    }
  }

  const result = await verifyReverbConnection({
    enabled: true,
    host: 'reverb-8080.herd.test',
    key: 'laravel-herd',
    port: 443,
    scheme: 'https',
  }, {
    WebSocketImpl: FakeWebSocket,
    timeoutMs: 50,
  });

  assert.equal(result.status, reverbStatuses.connected);
  assert.match(sockets[0].url, /^wss:\/\/reverb-8080\.herd\.test\/app\/laravel-herd\?/);
  assert.equal(sockets[0].closed, true);
});

test('requires Reverb confirmation before marking the connection connected', async () => {
  class FailingWebSocket {
    constructor() {
      queueMicrotask(() => this.emit('error', {}));
      this.listeners = {};
    }

    addEventListener(eventName, handler) {
      this.listeners[eventName] = [...(this.listeners[eventName] ?? []), handler];
    }

    close() {}

    emit(eventName, event) {
      for (const handler of this.listeners[eventName] ?? []) {
        handler(event);
      }
    }
  }

  const result = await verifyConnection({
    apiKey: ' secret-key ',
    domain: 'atlas.test/',
  }, {
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return {
          ok: true,
          reverb: {
            enabled: true,
            host: 'reverb-8080.herd.test',
            key: 'laravel-herd',
            port: 443,
            scheme: 'https',
          },
        };
      },
    }),
    reverbTimeoutMs: 50,
    WebSocketImpl: FailingWebSocket,
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.reverb.status, reverbStatuses.failed);
});

test('connect saves failed and connected verification state without background checks', async () => {
  const values = {};
  const storage = createStorage(values);
  const responses = [false, true];
  const requestedUrls = [];

  const failedConfig = await connectAndSaveConnectionConfig({
    apiKey: 'local-key',
    domain: 'atlas.test',
  }, {
    storage,
    fetchImpl: async (url) => {
      requestedUrls.push(url);

      return {
        ok: responses.shift(),
        async json() {
          return { ok: this.ok };
        },
      };
    },
  });

  assert.equal(failedConfig.status, 'failed');
  assert.equal(values[storageKey].profiles.live.status, 'failed');
  assert.deepEqual(await loadConnectionConfig(storage), failedConfig);

  const connectedConfig = await connectAndSaveConnectionConfig(failedConfig, {
    storage,
    fetchImpl: async (url) => {
      requestedUrls.push(url);

      return {
        ok: responses.shift(),
        async json() {
          return { ok: this.ok };
        },
      };
    },
  });

  assert.equal(connectedConfig.status, 'connected');
  assert.equal(values[storageKey].profiles.live.status, 'connected');
  assert.deepEqual(await loadConnectionConfig(storage), connectedConfig);
  assert.deepEqual(requestedUrls, [
    'https://atlas.test/api/extension/ping',
    'https://atlas.test/api/extension/ping',
  ]);
});

function createStorage(values) {
  return {
    async get(key) {
      return { [key]: values[key] };
    },
    async set(nextValues) {
      Object.assign(values, nextValues);
    },
  };
}
