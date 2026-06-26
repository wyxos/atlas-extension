import assert from 'node:assert/strict';
import test from 'node:test';

import * as connection from '../src/options/connection.js';

test('defaults to a blank live profile and resolves local from constants', async () => {
  const storage = createStorage();

  assert.deepEqual(connection.createDefaultConnectionState(), {
    mode: connection.connectionModes.live,
    profiles: {
      live: {
        apiKey: '',
        domain: '',
        status: connection.connectionStatuses.idle,
      },
      local: {
        status: connection.connectionStatuses.idle,
      },
    },
    version: 2,
  });

  assert.deepEqual(await connection.loadConnectionConfig(storage), {
    apiKey: '',
    domain: '',
    mode: connection.connectionModes.live,
    status: connection.connectionStatuses.idle,
  });

  await connection.saveConnectionMode(connection.connectionModes.local, storage);

  assert.deepEqual(await connection.loadConnectionConfig(storage), {
    apiKey: connection.localApiKey,
    domain: connection.localDomain,
    mode: connection.connectionModes.local,
    status: connection.connectionStatuses.idle,
  });
});

test('migrates legacy connection configs into matching profiles', async () => {
  const liveStorage = createStorage({
    [connection.storageKey]: {
      apiKey: 'live-key',
      connectedAt: '2026-06-26T10:00:00.000Z',
      domain: 'https://atlas.wyxos.com',
      status: connection.connectionStatuses.connected,
    },
  });
  const localStorage = createStorage({
    [connection.storageKey]: {
      apiKey: connection.localApiKey,
      domain: connection.localDomain,
      status: connection.connectionStatuses.connected,
    },
  });

  assert.deepEqual(await connection.loadConnectionState(liveStorage), {
    mode: connection.connectionModes.live,
    profiles: {
      live: {
        apiKey: 'live-key',
        connectedAt: '2026-06-26T10:00:00.000Z',
        domain: 'https://atlas.wyxos.com',
        status: connection.connectionStatuses.connected,
      },
      local: {
        status: connection.connectionStatuses.idle,
      },
    },
    version: 2,
  });

  assert.deepEqual(await connection.loadConnectionState(localStorage), {
    mode: connection.connectionModes.local,
    profiles: {
      live: {
        apiKey: '',
        domain: '',
        status: connection.connectionStatuses.idle,
      },
      local: {
        status: connection.connectionStatuses.connected,
      },
    },
    version: 2,
  });
});

test('saving a local connection preserves live profile values', async () => {
  const storage = createStorage({
    [connection.storageKey]: {
      mode: connection.connectionModes.live,
      profiles: {
        live: {
          apiKey: 'live-key',
          domain: 'https://atlas.wyxos.com',
          status: connection.connectionStatuses.connected,
        },
        local: {
          status: connection.connectionStatuses.idle,
        },
      },
      version: 2,
    },
  });

  await connection.saveConnectionConfig({
    apiKey: connection.localApiKey,
    domain: connection.localDomain,
    mode: connection.connectionModes.local,
    status: connection.connectionStatuses.connected,
  }, storage);

  const state = await connection.loadConnectionState(storage);

  assert.equal(state.mode, connection.connectionModes.local);
  assert.equal(state.version, 2);
  assert.deepEqual(state.profiles.live, {
    apiKey: 'live-key',
    domain: 'https://atlas.wyxos.com',
    status: connection.connectionStatuses.connected,
  });
  assert.equal(state.profiles.local.status, connection.connectionStatuses.connected);
  assert.match(state.profiles.local.connectedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(Object.keys(state.profiles.local).sort(), [
    'connectedAt',
    'status',
  ]);
});

function createStorage(initialValues = {}) {
  const values = { ...initialValues };

  return {
    async get(key) {
      return { [key]: values[key] };
    },
    async set(nextValues) {
      Object.assign(values, nextValues);
    },
  };
}
