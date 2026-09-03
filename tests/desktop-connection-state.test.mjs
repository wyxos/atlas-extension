import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDefaultDesktopConnectionState,
  clearDesktopClientCredentials,
  desktopConnectionStorageKey,
  loadDesktopConnectionState,
  patchDesktopConnectionState,
  hasDesktopClientCredentials,
  normalizeDesktopConnectionState,
  publicDesktopDiagnostics,
} from '../src/background/desktop-connection-state.js';

test('concurrent event checkpoints cannot resurrect credentials cleared by unpair', async () => {
  let state = { ...createDefaultDesktopConnectionState(), clientId: 'old', clientToken: 'old-token' };
  const storage = {
    async get() {
      const snapshot = globalThis.structuredClone(state);
      await new Promise((resolve) => globalThis.setImmediate(resolve));
      return { [desktopConnectionStorageKey]: snapshot };
    },
    async set(value) { state = globalThis.structuredClone(value[desktopConnectionStorageKey]); },
  };
  await Promise.all([
    patchDesktopConnectionState({ lastHeartbeatAt: '2026-09-04T00:00:00Z' }, storage),
    clearDesktopClientCredentials(storage),
  ]);
  const result = await loadDesktopConnectionState(storage);
  assert.equal(result.clientId, '');
  assert.equal(result.clientToken, '');
  assert.equal(result.lastHeartbeatAt, null);
});

test('defaults to the build channel without credentials', () => {
  const state = createDefaultDesktopConnectionState('dev');
  assert.equal(state.channel, 'dev');
  assert.equal(hasDesktopClientCredentials(state), false);
});

test('exposes client identity but never the client token in diagnostics', () => {
  const state = normalizeDesktopConnectionState({
    channel: 'dev',
    clientId: 'client-id',
    clientToken: 'secret-token',
    health: 'connected',
  });
  const diagnostics = publicDesktopDiagnostics(state, {
    getManifest: () => ({ version: '1.0.0' }),
  });

  assert.equal(diagnostics.clientId, 'client-id');
  assert.equal(diagnostics.paired, true);
  assert.doesNotMatch(JSON.stringify(diagnostics), /secret-token/);
});

test('drops credentials from a different or unknown build channel', () => {
  for (const channel of ['stable', 'preview']) {
    const state = normalizeDesktopConnectionState({
      channel,
      clientId: 'client-id',
      clientToken: 'secret-token',
    });

    assert.equal(state.channel, 'dev');
    assert.equal(state.clientId, '');
    assert.equal(state.clientToken, '');
  }
});

test('normalizes live event diagnostics without exposing credentials', () => {
  const state = normalizeDesktopConnectionState({
    channel: 'dev',
    clientId: 'client-id',
    clientToken: 'secret-token',
    eventConnectedAt: '2026-08-19T10:00:00Z',
    lastEventAt: '2026-08-19T10:01:00Z',
    lastHeartbeatAt: '2026-08-19T10:01:20Z',
    reconnectAttempt: 2,
  });
  const diagnostics = publicDesktopDiagnostics(state);

  assert.equal(diagnostics.eventConnectedAt, '2026-08-19T10:00:00Z');
  assert.equal(diagnostics.lastEventAt, '2026-08-19T10:01:00Z');
  assert.equal(diagnostics.lastHeartbeatAt, '2026-08-19T10:01:20Z');
  assert.equal(diagnostics.reconnectAttempt, 2);
  assert.doesNotMatch(JSON.stringify(diagnostics), /secret-token/);
});

test('persists only normalized Desktop hello capabilities', () => {
  const state = normalizeDesktopConnectionState({
    capabilities: ['close-tab-mode', '', 'close-tab-mode', 42],
    channel: 'dev',
  });

  assert.deepEqual(state.capabilities, ['close-tab-mode']);
  assert.deepEqual(publicDesktopDiagnostics(state).capabilities, ['close-tab-mode']);
});
