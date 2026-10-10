import assert from 'node:assert/strict';
import test from 'node:test';
import { createDesktopTransport } from '../src/background/desktop-transport.js';
import { serializeDesktopError } from '../src/shared/desktop-contract.js';
import { sendBackgroundRequest } from '../src/content/background-api.js';
import { reactionFailureFromError } from '../src/content/reaction-failure-state.js';
import { collectReactionRuntimeContext } from '../src/background/reaction-runtime-context.js';

const reference = '12345678-1234-4abc-8abc-123456789abc';
const credentials = { channel: 'dev', clientId: 'fixture-client', clientToken: 'fixture-token' };

test('cookie host permission denial survives worker and page error mapping without leaking the browser URL', async () => {
  for (const type of ['atlas-extension.asset-reaction', 'atlas-extension.asset-reaction-batch']) {
    let captured;
    await assert.rejects(collectReactionRuntimeContext({ type, reactionType: 'like' }, {
      tabId: 2, requireTab: true, chromeApi: { cookies: {
        getAllCookieStores: done => done([{ id: 'selected', tabIds: [2] }]),
        getPartitionKey: async () => { throw new Error('No host permissions for cookies at url: "https://private.example/?token=hidden".'); },
        getAll: () => assert.fail('A denied partition must not read cookies with a different scope'),
      } },
    }), error => { captured = error; return error.code === 'BROWSER_SESSION_UNAVAILABLE'; });
    captured.requestId = reference;
    const workerFailure = reactionFailureFromError(captured);
    const response = { code: workerFailure.errorCode, message: workerFailure.message,
      details: workerFailure.details, requestId: workerFailure.requestId, retryable: workerFailure.retryable };
    await assert.rejects(sendBackgroundRequest({ type }, { runtime: {
      sendMessage(message, callback) {
        if (message.type === 'atlas-extension.reaction-failure') { callback(); return; }
        callback({ ok: false, error: response });
      },
    } }), error => {
      const failure = reactionFailureFromError(error);
      assert.deepEqual(failure.details, { reason: 'HOST_PERMISSION_DENIED' });
      assert.match(failure.message, /site access/i);
      assert.match(failure.message, /cookie/i);
      assert.equal(failure.requestId, reference);
      assert.doesNotMatch(JSON.stringify(failure), /private|https:|hidden/i);
      return true;
    });
  }
});

test('only the known browser session permission category becomes recovery text', () => {
  for (const code of ['BROWSER_SESSION_UNAVAILABLE', 'REACTION_FAILED']) {
    for (const reason of ['https://private.example/?token=hidden', '__proto__', 'constructor', undefined]) {
      const failure = reactionFailureFromError({ code, details: { reason, token: 'hidden' } });
      assert.equal(failure.details, undefined);
      assert.doesNotMatch(JSON.stringify(failure), /private|hidden|constructor|__proto__/i);
    }
  }
  assert.equal(reactionFailureFromError({ code: 'REACTION_FAILED', details: { reason: 'HOST_PERMISSION_DENIED' } }).details, undefined);
  assert.deepEqual(reactionFailureFromError({ code: 'BROWSER_SESSION_UNAVAILABLE',
    details: { reason: 'HOST_PERMISSION_DENIED', token: 'hidden' } }).details, { reason: 'HOST_PERMISSION_DENIED' });
});

test('a rejected batch preserves its diagnostic reference across transport and background messaging', async () => {
  const transport = createDesktopTransport({
    channel: 'dev',
    fetchImpl: async () => ({
      ok: false,
      status: 400,
      json: async () => ({ ok: false, request_id: reference, error: {
        code: 'REACTION_BATCH_FAILED', message: 'Private media URL https://private.example/file?token=hidden',
        details: { path: 'private-file-path' }, retryable: false,
      } }),
    }),
  });
  let serialized;
  await assert.rejects(transport.reactionBatch(credentials, {}), error => {
    serialized = serializeDesktopError(error);
    assert.equal(serialized.requestId, reference);
    return error.code === 'REACTION_BATCH_FAILED';
  });
  await assert.rejects(sendBackgroundRequest({}, { runtime: {
    sendMessage(_message, callback) { callback({ ok: false, error: serialized }); },
  } }), error => {
    const failure = reactionFailureFromError(error);
    assert.equal(failure.errorCode, 'REACTION_BATCH_FAILED');
    assert.equal(failure.requestId, reference);
    assert.match(failure.message, /Desktop diagnostics/);
    assert.match(failure.message, /REACTION_BATCH_FAILED/);
    assert.ok(failure.message.includes(`Reference: ${reference}`));
    assert.doesNotMatch(failure.message, /private|https:|hidden/i);
    return true;
  });
});

test('only UUID-shaped correlation identifiers are serialized or displayed', () => {
  for (const value of [null, undefined, 123, '', 'https://private.example/token', '../secret', reference + '\nprivate', 'x'.repeat(10000)]) {
    const error = { code: 'REACTION_BATCH_FAILED', requestId: value };
    assert.equal(serializeDesktopError(error).requestId, undefined);
    assert.equal(reactionFailureFromError(error).requestId, undefined);
    assert.doesNotMatch(reactionFailureFromError(error).message, /Reference:/);
  }
  assert.equal(serializeDesktopError({ request_id: reference.toUpperCase() }).requestId, reference);
});

test('unknown or attacker-controlled error codes and raw errors never become banner text', () => {
  for (const code of ['https://private.example/token', '__proto__', 'constructor', 'SECRET_TOKEN', undefined]) {
    const failure = reactionFailureFromError({ code, message: 'private server response', details: { token: 'hidden' } });
    assert.equal(failure.errorCode, 'REACTION_REQUEST_FAILED');
    assert.match(failure.message, /Retry/);
    assert.doesNotMatch(failure.message, /private|secret|https:|hidden|constructor|__proto__/i);
  }
});

test('gallery lifecycle and Desktop validation failures provide distinct recovery actions', () => {
  const cases = [
    ['BATCH_PROVIDER_CHANGED', /Start the batch again/],
    ['BATCH_PROVIDER_UNAVAILABLE', /plugin is enabled/],
    ['BATCH_POST_CHANGED', /current post/],
    ['BATCH_INCOMPLETE', /Already queued items remain saved/],
    ['BATCH_CANCELLED', /Use Retry to continue/],
    ['GALLERY_REQUEST_PENDING', /awaiting acknowledgement/],
    ['INVALID_REACTION_BATCH', /Update Desktop and the extension/],
    ['DATABASE_UNAVAILABLE', /service status/],
    ['PROVIDER_RESOLUTION_FAILED', /plugin and account/],
    ['PAIRING_REQUIRED', /Pair the extension/],
  ];
  for (const [code, expected] of cases) {
    const failure = reactionFailureFromError({ code, retryable: true });
    assert.match(failure.message, expected);
    assert.ok(failure.message.includes(`[${code}]`));
    assert.equal(failure.retryable, true);
  }
});
