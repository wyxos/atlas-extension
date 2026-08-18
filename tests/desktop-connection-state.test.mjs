import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDefaultDesktopConnectionState,
  hasDesktopClientCredentials,
  normalizeDesktopConnectionState,
  publicDesktopDiagnostics,
} from '../src/background/desktop-connection-state.js';

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
