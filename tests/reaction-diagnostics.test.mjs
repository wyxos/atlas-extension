import assert from 'node:assert/strict';
import test from 'node:test';
import { createReactionFailureHistory } from '../src/background/reaction-diagnostics.js';
import { safeReactionDiagnostic, reactionRequestId } from '../src/shared/reaction-diagnostics.js';
import { reactionFailureFromError } from '../src/content/reaction-failure-state.js';
import { sendBackgroundRequest } from '../src/content/background-api.js';
import { createDesktopTransport } from '../src/background/desktop-transport.js';

const requestId = '12345678-1234-4234-9234-123456789abc';
const failure = { requestId, code: 'BROWSER_SESSION_UNAVAILABLE', phase: 'preparing-session', operation: 'reaction' };
const credentials = { clientId: 'fixture', clientToken: 'synthetic', channel: 'dev', capabilities: ['extension-diagnostics-v1'] };
function fixture() {
  let data = {};
  return { get: async () => globalThis.structuredClone(data), set: async value => { data = globalThis.structuredClone(value); } };
}

test('session and capability failures retain fixed recovery advice without private errors', () => {
  for (const code of ['BROWSER_SESSION_UNAVAILABLE', 'BROWSER_SESSION_TOO_LARGE', 'BROWSER_SESSION_AMBIGUOUS',
    'BROWSER_SESSION_HEADERS_INVALID', 'BROWSER_SESSION_EXPIRED', 'DESKTOP_CAPABILITY_REQUIRED',
    'EXTENSION_WORKER_UNAVAILABLE', 'EXTENSION_REQUEST_TIMEOUT', 'EXTENSION_MESSAGE_FAILED']) {
    const result = reactionFailureFromError({ code, requestId, message: 'secret-path private-token', details: { password: 'private' } });
    assert.equal(result.errorCode, code);
    assert.ok(result.message.includes(requestId));
    assert.doesNotMatch(result.message, /secret-path|private-token/);
  }
});

test('local history survives worker reconstruction, stays bounded and drops raw fields', async () => {
  const storage = fixture();
  const history = createReactionFailureHistory({ storage });
  await history.record({ ...failure, message: 'secret URL', stack: 'private trace', details: { password: 'secret' } });
  await history.record(failure);
  assert.equal((await history.snapshot()).length, 1);
  for (let index = 0; index < 105; index++) await history.record({ ...failure, requestId: reactionRequestId() });
  const restored = await createReactionFailureHistory({ storage }).snapshot();
  assert.equal(restored.length, 100);
  assert.doesNotMatch(JSON.stringify(restored), /secret|private|password|stack/);
  assert.equal(safeReactionDiagnostic({ requestId: 'private-url' }), null);
  assert.equal(safeReactionDiagnostic({ ...failure, code: 'private-token' }).code, 'REACTION_REQUEST_FAILED');
});

test('offline evidence retries only on explicit connection events and older Desktop is skipped', async () => {
  const history = createReactionFailureHistory({ storage: fixture() });
  await history.record(failure);
  let calls = 0;
  const transport = { reactionFailure: async () => { calls++; throw new Error('synthetic offline'); } };
  await history.flush({ credentials: { ...credentials, capabilities: [] }, transport });
  assert.equal(calls, 0);
  await assert.rejects(history.flush({ credentials, transport }));
  assert.equal(calls, 1);
  assert.equal((await history.snapshot())[0].delivered, false);
  transport.reactionFailure = async (_credentials, event) => {
    calls++;
    assert.equal(event.requestId, requestId);
    assert.equal(event.delivered, undefined);
  };
  await history.flush({ credentials, transport });
  await history.flush({ credentials, transport });
  assert.equal(calls, 2);
  assert.equal((await history.snapshot())[0].delivered, true);
});

test('worker failures keep the initiating UUID and use typed codes', async () => {
  await assert.rejects(sendBackgroundRequest({ type: 'atlas-extension.asset-reaction', requestId }, { runtime: {} }), error => {
    assert.equal(error.code, 'EXTENSION_WORKER_UNAVAILABLE');
    assert.equal(error.requestId, requestId);
    return true;
  });
  const messages = [];
  await assert.rejects(sendBackgroundRequest({ type: 'atlas-extension.asset-reaction', requestId }, {
    timeoutMs: 1, runtime: { sendMessage: (message) => { messages.push(message); } },
  }), error => error.code === 'EXTENSION_REQUEST_TIMEOUT' && error.requestId === requestId);
  assert.equal(messages[1].failure.requestId, requestId);
  assert.equal(messages[1].failure.phase, 'background-message');
});

test('a fresh connection event takes over an older failing in-flight relay', async () => {
  const history = createReactionFailureHistory({ storage: fixture() });
  await history.record(failure);
  let rejectOld;
  const oldSend = new Promise((_resolve, reject) => { rejectOld = reject; });
  const pending = history.flush({ credentials, transport: { reactionFailure: () => oldSend } });
  let newCalls = 0;
  const next = history.flush({ credentials: { ...credentials, clientToken: 'new-fixture-token' },
    transport: { reactionFailure: async () => { newCalls++; } } });
  rejectOld(new Error('retired pairing'));
  await Promise.all([pending, next]);
  assert.equal(newCalls, 1);
  assert.equal((await history.snapshot())[0].delivered, true);
});

test('correlation header is capability gated and server references survive', async () => {
  const requests = [];
  const transport = createDesktopTransport({ channel: 'dev', fetchImpl: async (_url, options) => {
    requests.push(options);
    return { ok: false, status: 400, json: async () => ({ ok: false, request_id: requestId,
      error: { code: 'REACTION_FAILED', message: 'synthetic', retryable: false } }) };
  } });
  await assert.rejects(transport.reaction(credentials, {}, { requestId }), error => error.requestId === requestId);
  assert.equal(requests[0].headers['X-Atlas-Request-Id'], requestId);
  await assert.rejects(transport.reaction({ ...credentials, capabilities: [] }, {}, { requestId }));
  assert.equal(requests[1].headers['X-Atlas-Request-Id'], undefined);
});
