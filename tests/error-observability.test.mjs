import assert from 'node:assert/strict';
import test from 'node:test';
import { sendBackgroundRequest } from '../src/content/background-api.js';
import { submitWithProviderFallback } from '../src/content/provider-reaction.js';
import { stateWithoutAtlasAssetStatus } from '../src/content/asset-state.js';
import { createBadgePresentation } from '../src/content/badge-model.js';
import { createBadgeFileActions } from '../src/content/badge-file-actions.js';

test('provider failure is reported before awaiting a fallback decision for either reaction kind', async () => {
  for (const type of ['atlas-extension.asset-reaction', 'atlas-extension.asset-reaction-batch']) {
    const calls = [];
    const error = { code: 'PROVIDER_RESOLUTION_FAILED', message: 'Provider unavailable', retryable: true };
    const result = await submitWithProviderFallback({
      submit: () => sendBackgroundRequest({ type }, { runtime: { sendMessage(_message, cb) { cb({ ok: false, error }); } } }),
      onFailure: (failure) => calls.push(failure.code),
      confirmFallback: async () => { assert.deepEqual(calls, ['PROVIDER_RESOLUTION_FAILED']); return 'cancel'; },
    });
    assert.equal(result, null);
  }
});

test('empty and malformed worker replies never acknowledge a mutation', async () => {
  for (const reply of [undefined, {}, { ok: true }, { ok: true, payload: null }]) {
    await assert.rejects(sendBackgroundRequest({}, { runtime: { sendMessage(_message, cb) { cb(reply); } } }), { code: 'INVALID_RESPONSE' });
  }
});

test('a silent worker times out rather than leaving an action busy forever', async () => {
  await assert.rejects(sendBackgroundRequest({}, { timeoutMs: 5, runtime: { sendMessage() {} } }), /timed out/);
});

test('status misses preserve user-action errors and the badge presents them', () => {
  const state = stateWithoutAtlasAssetStatus({
    reactionFailure: { message: 'Provider unavailable', errorCode: 'PROVIDER_RESOLUTION_FAILED' },
    closeTabError: 'Close failed', widgetPlacementError: 'Position failed', fileActionError: 'Open failed',
    file: { id: 10 },
  });
  assert.equal(state.file, undefined);
  const badge = createBadgePresentation({ source: 'https://fixture.test/a' }, null, 0, state);
  assert.match(badge.failureMessage, /Provider unavailable/);
  assert.equal(badge.closeTabError, 'Close failed');
  assert.equal(badge.widgetPlacementError, 'Position failed');
  assert.equal(badge.fileActionError, 'Open failed');
});

test('open/delete failures reach the page notice even if the widget disappears', async () => {
  const notices = [];
  const states = [];
  const actions = createBadgeFileActions({
    assetsById: new Map([['a', { source: 'https://fixture.test/a' }]]),
    badgeStatesById: new Map([['a', { file: { id: 10 } }]]),
    resolveFileId: () => 10,
    openFile: async () => { throw new Error('private'); },
    deleteFile: async () => { throw new Error('private'); },
    shouldApplyResponse: () => false,
    updateBadgeState: (_id, state) => states.push(state),
    reportFailure: (message) => notices.push(message),
  });
  await actions.handleOpenFile({ id: 'a' });
  await actions.handleDelete({ id: 'a' });
  assert.equal(notices.length, 2);
  assert.match(notices[0], /Could not open/);
  assert.match(notices[1], /Could not delete/);
  assert.ok(notices.every((message) => !message.includes('private')));
});
