import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDefaultDesktopConnectionState,
  desktopConnectionStorageKey,
} from '../src/background/desktop-connection-state.js';
import { createDesktopRuntime } from '../src/background/desktop-runtime.js';

test('shares one in-progress initialization and creates one event client per profile', async () => {
  const storage = createStorage({
    [desktopConnectionStorageKey]: {
      ...createDefaultDesktopConnectionState('dev'),
      channel: 'dev',
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
    protocol_version: 1,
  });
  await Promise.all([first, second]);

  assert.equal(helloCalls, 1);
  assert.equal(eventClientCreations, 1);
  assert.equal(eventClientStarts, 1);
});

test('routes close tab mode changes through the authenticated Desktop runtime', async () => {
  const storage = createStorage({
    [desktopConnectionStorageKey]: {
      ...createDefaultDesktopConnectionState('dev'),
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
