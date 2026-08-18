import assert from 'node:assert/strict';
import test from 'node:test';

import { desktopConnectionStorageKey } from '../src/background/desktop-connection-state.js';
import { syncDesktopRuntimePolicy } from '../src/background/desktop-runtime-policy.js';
import { assetSourcePreferencesKey } from '../src/shared/asset-source-preferences.js';

test('applies a monotonic read-only Desktop runtime policy', async () => {
  const storage = createStorage({
    [desktopConnectionStorageKey]: {
      channel: 'dev',
      clientId: 'client',
      clientToken: 'token',
      runtimePolicyRevision: 2,
    },
  });
  const result = await syncDesktopRuntimePolicy({
    credentials: storage.values()[desktopConnectionStorageKey],
    storage,
    transport: {
      runtimePolicy: async () => ({
        revision: 3,
        settings: {
          schemaVersion: 1,
          settings: {
            assetSourcePreferences: { domains: ['reddit.com'], version: 3 },
          },
        },
      }),
    },
  });

  assert.equal(result.revision, 3);
  assert.deepEqual(storage.values()[assetSourcePreferencesKey].domains, ['reddit.com']);
  assert.equal(storage.values()[desktopConnectionStorageKey].clientToken, 'token');
  assert.equal(storage.values()[desktopConnectionStorageKey].runtimePolicyRevision, 3);
});

test('rejects policy rollback', async () => {
  const storage = createStorage({
    [desktopConnectionStorageKey]: { channel: 'dev', runtimePolicyRevision: 5 },
  });

  await assert.rejects(syncDesktopRuntimePolicy({
    credentials: {},
    storage,
    transport: { runtimePolicy: async () => ({ revision: 4, settings: {} }) },
  }), (error) => error.code === 'STALE_RUNTIME_POLICY');
});

function createStorage(initial) {
  const values = globalThis.structuredClone(initial);
  return {
    async get(key) { return { [key]: values[key] }; },
    async set(next) { Object.assign(values, globalThis.structuredClone(next)); },
    values: () => globalThis.structuredClone(values),
  };
}
