import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDefaultDesktopConnectionState,
  desktopConnectionStorageKey,
} from '../src/background/desktop-connection-state.js';
import { createDesktopRuntime } from '../src/background/desktop-runtime.js';
import { createDesktopContractError } from '../src/shared/desktop-contract.js';

function pairedStorage() {
  return createStorage({
    unrelatedSetting: { retained: true },
    [desktopConnectionStorageKey]: {
      ...createDefaultDesktopConnectionState('dev'),
      clientId: 'client-old',
      clientToken: 'token-old',
      eventSequence: 4971,
      eventConnectedAt: '2026-08-26T00:00:00Z',
      lastEventAt: '2026-08-24T00:00:00Z',
      lastHeartbeatAt: '2026-08-24T00:00:00Z',
      reconnectAttempt: 20,
      runtimePolicyRevision: 9,
      lastError: { code: 'PAIRING_REQUIRED', message: 'Not authorized.', retryable: false },
    },
  });
}

for (const action of ['initialize', 'reconnect', 'cancelPairing']) {
  test(`${action} clears an abandoned pairing and permits a fresh request`, async () => {
    const storage = createStorage({
      unrelatedSetting: { retained: true },
      [desktopConnectionStorageKey]: {
        ...createDefaultDesktopConnectionState('dev'),
        pairingPending: true,
      },
    });
    const runtime = createDesktopRuntime({
      storage,
      createEventClient: () => ({ async start() {}, stop() {} }),
      transport: {
        channel: 'dev',
        async hello() { return { app: { channel: 'dev' }, protocol_version: 1 }; },
        async pair() { return { client_id: 'client-new', client_token: 'token-new' }; },
        async runtimePolicy() { return { revision: 0, settings: { schemaVersion: 1, settings: {} } }; },
      },
    });

    const recovered = await runtime[action]();
    assert.equal(recovered.pairingPending, false);
    assert.equal(recovered.paired, false);
    assert.equal((await storage.get(desktopConnectionStorageKey))[desktopConnectionStorageKey].pairingPending, false);
    assert.deepEqual(await storage.get('unrelatedSetting'), { unrelatedSetting: { retained: true } });
    const paired = await runtime.pair();
    assert.equal(paired.pairingPending, false);
    assert.equal(paired.paired, true);
  });
}

test('initialization clears abandoned pairing even when Desktop is offline', async () => {
  const runtime = createDesktopRuntime({
    storage: createStorage({
      [desktopConnectionStorageKey]: { ...createDefaultDesktopConnectionState('dev'), pairingPending: true },
    }),
    transport: {
      channel: 'dev',
      async hello() { throw createDesktopContractError('DESKTOP_OFFLINE', 'Offline.', true); },
    },
  });
  const result = await runtime.initialize();
  assert.equal(result.pairingPending, false);
  assert.equal(result.health, 'offline');
});

test('reconnect preserves live pairing and cancel aborts it before retry', async () => {
  const started = deferred();
  let signal;
  const runtime = createDesktopRuntime({
    storage: createStorage({}),
    createEventClient: () => ({ async start() {}, stop() {} }),
    transport: {
      channel: 'dev',
      async hello() { return { app: { channel: 'dev' }, protocol_version: 1 }; },
      async pair(options) {
        if (signal) return { client_id: 'client-new', client_token: 'token-new' };
        signal = options.signal;
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          started.resolve();
        });
      },
      async runtimePolicy() { return { revision: 0, settings: { schemaVersion: 1, settings: {} } }; },
    },
  });
  const pairing = runtime.pair();
  const cancelled = assert.rejects(pairing, { code: 'PAIRING_CANCELLED' });
  await started.promise;
  assert.equal((await runtime.reconnect()).pairingPending, true);
  await assert.rejects(runtime.pair(), { code: 'PAIRING_PENDING' });
  assert.equal((await runtime.cancelPairing()).pairingPending, false);
  assert.equal(signal.aborted, true);
  await cancelled;
  assert.equal((await runtime.pair()).paired, true);
});

for (const code of ['PAIRING_REQUIRED', 'CLIENT_REVOKED', 'INVALID_CLIENT', 'UNAUTHORIZED']) {
  test(`unpair clears rejected ${code} credentials and permits a fresh dev pairing`, async () => {
    const storage = pairedStorage();
    let starts = 0;
    const runtime = createDesktopRuntime({
      storage,
      createEventClient: () => ({ async start() { starts += 1; }, stop() {} }),
      transport: {
        channel: 'dev',
        async unpair(credentials) {
          assert.equal(credentials.clientId, 'client-old');
          throw createDesktopContractError(code, 'Not authorized.');
        },
        async pair() { return { client_id: 'client-new', client_token: 'token-new' }; },
        async hello() {
          return { app: { channel: 'dev', version: '1.0.0' }, protocol_version: 1, capabilities: [] };
        },
        async runtimePolicy(credentials) {
          assert.equal(credentials.clientId, 'client-new');
          return { revision: 1, settings: { schemaVersion: 1, settings: {} } };
        },
      },
    });

    const cleared = await runtime.unpair();
    assert.equal(cleared.paired, false);
    assert.equal(cleared.health, 'unpaired');
    assert.equal(cleared.eventStatus, 'disconnected');
    assert.equal(cleared.eventSequence, 0);
    assert.equal(cleared.reconnectAttempt, 0);
    for (const field of ['clientId', 'runtimePolicyRevision', 'lastError', 'eventConnectedAt', 'lastEventAt', 'lastHeartbeatAt']) {
      assert.equal(cleared[field], null, field);
    }
    assert.equal((await storage.get(desktopConnectionStorageKey))[desktopConnectionStorageKey].clientToken, '');
    assert.deepEqual(await storage.get('unrelatedSetting'), { unrelatedSetting: { retained: true } });
    const paired = await runtime.pair();
    assert.equal(paired.paired, true);
    assert.equal(paired.clientId, 'client-new');
    assert.equal(paired.runtimePolicyRevision, 1);
    assert.equal(starts, 1);
  });
}

test('reconnect clears Desktop PAIRING_REQUIRED credentials instead of leaving Pair hidden', async () => {
  const runtime = createDesktopRuntime({
    storage: pairedStorage(),
    transport: {
      channel: 'dev',
      async hello() { return { app: { channel: 'dev' }, protocol_version: 1 }; },
      async runtimePolicy() { throw createDesktopContractError('PAIRING_REQUIRED', 'Not authorized.'); },
    },
  });
  await assert.rejects(runtime.reconnect(), { code: 'PAIRING_REQUIRED' });
  assert.equal((await runtime.diagnostics()).paired, false);
  assert.equal((await runtime.diagnostics()).runtimePolicyRevision, null);
});

test('unpair preserves credentials and reports unexpected remote failures', async () => {
  const runtime = createDesktopRuntime({
    storage: pairedStorage(),
    transport: {
      channel: 'dev',
      async unpair() { throw createDesktopContractError('DESKTOP_OFFLINE', 'Offline.', true); },
    },
  });
  await assert.rejects(runtime.unpair(), { code: 'DESKTOP_OFFLINE' });
  assert.equal((await runtime.diagnostics()).paired, true);
});

test('event ticket authorization failure clears credentials and stops reconnecting', async () => {
  let tickets = 0;
  const storage = pairedStorage();
  // The saved policy is current here; rejection occurs only on the event endpoint.
  const runtime = createDesktopRuntime({
    storage,
    transport: {
      channel: 'dev',
      async hello() { return { app: { channel: 'dev' }, protocol_version: 1 }; },
      async runtimePolicy() { return { revision: 9, settings: { schemaVersion: 1, settings: {} } }; },
      async eventTicket() {
        tickets += 1;
        throw createDesktopContractError('PAIRING_REQUIRED', 'Not authorized.');
      },
    },
  });
  const result = await runtime.reconnect();
  assert.equal(result.paired, false);
  assert.equal(result.health, 'unpaired');
  assert.equal(result.eventStatus, 'disconnected');
  assert.equal(result.reconnectAttempt, 0);
  assert.equal(result.lastError.code, 'PAIRING_REQUIRED');
  assert.equal(tickets, 1);
});

test('shares one in-progress initialization and creates one event client per profile', async () => {
  const storage = createStorage({
    [desktopConnectionStorageKey]: {
      ...createDefaultDesktopConnectionState('dev'),
      channel: 'dev',
      capabilities: ['close-tab-mode'],
      clientId: 'client-1',
      clientToken: 'token-1',
    },
  });
  const helloGate = deferred();
  let helloCalls = 0;
  let eventClientCreations = 0;
  let eventClientStarts = 0;
  const runtime = createDesktopRuntime({
    createEventClient() {
      eventClientCreations += 1;
      return {
        async start() { eventClientStarts += 1; },
        stop() {},
      };
    },
    runtime: { getManifest: () => ({ version: '1.0.0' }) },
    storage,
    transport: {
      channel: 'dev',
      async hello() {
        helloCalls += 1;
        return helloGate.promise;
      },
      async runtimePolicy() {
        return {
          revision: 1,
          settings: { schemaVersion: 1, settings: {} },
        };
      },
    },
  });

  const first = runtime.initialize();
  const second = runtime.initialize();
  helloGate.resolve({
    app: { channel: 'dev', version: '1.0.0' },
    capabilities: ['close-tab-mode'],
    protocol_version: 1,
  });
  await Promise.all([first, second]);

  assert.equal(helloCalls, 1);
  assert.equal(eventClientCreations, 1);
  assert.equal(eventClientStarts, 1);
});

test('rejects close tab mode changes when Desktop did not advertise the capability', async () => {
  const storage = createStorage({
    [desktopConnectionStorageKey]: {
      ...createDefaultDesktopConnectionState('dev'),
      channel: 'dev',
      clientId: 'client-1',
      clientToken: 'token-1',
      runtimePolicyRevision: 5,
    },
  });
  const runtime = createDesktopRuntime({ storage, transport: { channel: 'dev' } });
  const response = new Promise((resolve) => {
    runtime.handleMessage({
      mode: 'after_queue',
      siteDomain: 'deviantart.com',
      type: 'atlas-extension.desktop.update-close-tab-mode',
    }, resolve);
  });

  assert.deepEqual(await response, {
    error: {
      code: 'DESKTOP_CAPABILITY_REQUIRED',
      details: undefined,
      message: 'Atlas Desktop does not support close tab mode settings.',
      retryable: false,
    },
    ok: false,
  });
});

test('routes close tab mode changes through the authenticated Desktop runtime', async () => {
  const storage = createStorage({
    [desktopConnectionStorageKey]: {
      ...createDefaultDesktopConnectionState('dev'),
      channel: 'dev',
      capabilities: ['close-tab-mode'],
      clientId: 'client-1',
      clientToken: 'token-1',
      runtimePolicyRevision: 5,
    },
  });
  let body = null;
  const runtime = createDesktopRuntime({
    storage,
    transport: {
      channel: 'dev',
      async updateCloseTabMode(_credentials, nextBody) {
        body = nextBody;
        return { mode: nextBody.mode, revision: 6, site_domain: nextBody.site_domain };
      },
    },
  });
  const response = new Promise((resolve) => {
    assert.equal(runtime.handleMessage({
      mode: 'on_complete',
      siteDomain: 'deviantart.com',
      type: 'atlas-extension.desktop.update-close-tab-mode',
    }, resolve), true);
  });

  assert.deepEqual(await response, {
    ok: true,
    payload: { mode: 'on_complete', revision: 6, siteDomain: 'deviantart.com' },
  });
  assert.deepEqual(body, {
    expected_revision: 5,
    mode: 'on_complete',
    site_domain: 'deviantart.com',
  });
});

test('rejects batch provider changes when Desktop did not advertise the capability', async () => {
  const storage = createStorage({
    [desktopConnectionStorageKey]: {
      ...createDefaultDesktopConnectionState('dev'),
      channel: 'dev',
      clientId: 'client-1',
      clientToken: 'token-1',
      runtimePolicyRevision: 5,
    },
  });
  const runtime = createDesktopRuntime({ storage, transport: { channel: 'dev' } });
  const response = new Promise((resolve) => {
    runtime.handleMessage({
      enabled: true,
      provider: 'deviantart',
      type: 'atlas-extension.desktop.update-batch-provider-preference',
    }, resolve);
  });

  assert.deepEqual(await response, {
    error: {
      code: 'DESKTOP_CAPABILITY_REQUIRED',
      details: undefined,
      message: 'Atlas Desktop does not support batch provider preferences.',
      retryable: false,
    },
    ok: false,
  });
});

test('routes batch provider changes through the authenticated Desktop runtime', async () => {
  const storage = createStorage({
    [desktopConnectionStorageKey]: {
      ...createDefaultDesktopConnectionState('dev'),
      capabilities: ['batch-provider-preference'],
      channel: 'dev',
      clientId: 'client-1',
      clientToken: 'token-1',
      runtimePolicyRevision: 5,
    },
  });
  let body = null;
  const runtime = createDesktopRuntime({
    storage,
    transport: {
      channel: 'dev',
      async updateBatchProviderPreference(_credentials, nextBody) {
        body = nextBody;
        return { enabled: nextBody.enabled, provider: nextBody.provider, revision: 6 };
      },
    },
  });
  const response = new Promise((resolve) => {
    assert.equal(runtime.handleMessage({
      enabled: true,
      provider: 'deviantart',
      type: 'atlas-extension.desktop.update-batch-provider-preference',
    }, resolve), true);
  });

  assert.deepEqual(await response, {
    ok: true,
    payload: { enabled: true, provider: 'deviantart', revision: 6 },
  });
  assert.deepEqual(body, {
    enabled: true,
    expected_revision: 5,
    provider: 'deviantart',
  });
});

function createStorage(initial) {
  const values = globalThis.structuredClone(initial);
  return {
    async get(key) { return { [key]: globalThis.structuredClone(values[key]) }; },
    async set(next) { Object.assign(values, globalThis.structuredClone(next)); },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((next) => { resolve = next; });
  return { promise, resolve };
}
