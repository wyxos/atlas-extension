import assert from 'node:assert/strict';
import test from 'node:test';
import { collectReactionRuntimeContext } from '../src/background/reaction-runtime-context.js';
import { createRequestSessionCapture } from '../src/background/request-session-capture.js';
import { createReactionFailureHistory } from '../src/background/reaction-diagnostics.js';
import { reactionDiagnosticFromError, safeReactionDiagnostic } from '../src/shared/reaction-diagnostics.js';
import { createDesktopTransport } from '../src/background/desktop-transport.js';

const requestId = '12345678-1234-4234-9234-123456789abc';
const source = 'https://private.example.test/media?token=synthetic-url-secret';
const base = { requestId, code: 'BROWSER_SESSION_AMBIGUOUS', phase: 'preparing-session', operation: 'reaction' };
const reasons = ['COOKIE_VALUE_CONFLICT', 'COOKIE_SECURITY_ATTRIBUTE_CONFLICT',
  'HEADER_AUTHORIZATION_CONFLICT', 'HEADER_CUSTOM_CONFLICT'];
const credentials = { clientId: 'fixture', clientToken: 'synthetic', channel: 'dev', capabilities: ['extension-diagnostics-v1'] };

async function cookieConflict(change) {
  const cookie = { name: 'synthetic-cookie-name', value: 'synthetic-cookie-secret', domain: 'private.example.test',
    path: '/', secure: true, httpOnly: true, hostOnly: true };
  const chromeApi = { cookies: {
    getAllCookieStores: done => done([{ id: 'selected', tabIds: [2] }]),
    getAll: (details, done) => {
      assert.equal(details.storeId, 'selected');
      done([cookie, { ...cookie, ...change }]);
    },
  } };
  try {
    await collectReactionRuntimeContext({ asset: { source }, reactionType: 'like' }, { chromeApi, tabId: 2, requireTab: true });
    assert.fail('synthetic conflict must fail');
  } catch (error) { return error; }
}

function headerConflict(name, value) {
  const capture = createRequestSessionCapture({ now: () => 1000 });
  for (const [frameId, documentId, headerValue] of [[0, 'top', 'synthetic-header-secret'], [7, 'selected', value]]) {
    const requestId = String(frameId);
    capture.observe({ tabId: 2, frameId, documentId, requestId, method: 'GET', url: source,
      requestHeaders: headerValue === undefined ? [] : [{ name, value: headerValue }] });
    capture.complete({ requestId, statusCode: 200 });
  }
  try {
    capture.snapshot(2, [source], { frameId: 7, documentId: 'selected', topPageUrl: source });
    assert.fail('synthetic conflict must fail');
  } catch (error) { return error; }
}

test('real session conflict producers expose only fixed reasons, not conflicting data', async () => {
  const errors = [await cookieConflict({ value: 'other-cookie-secret' }), await cookieConflict({ secure: false }),
    headerConflict('Authorization', 'other-header-secret'), headerConflict('X-Synthetic-Secret-Name', undefined)];
  for (const [index, error] of errors.entries()) {
    assert.equal(error.code, 'BROWSER_SESSION_AMBIGUOUS');
    assert.deepEqual(error.details, { reason: reasons[index] });
    assert.doesNotMatch(JSON.stringify(error.details), /secret|private|example|https|selected/);
  }
});

test('reason sanitizer accepts fixed conflict reasons only for the expected code and phase', () => {
  for (const reason of reasons) assert.equal(safeReactionDiagnostic({ ...base, reason }).reason, reason);
  for (const reason of ['synthetic-cookie-secret', source, { reason: 'COOKIE_VALUE_CONFLICT' }, null]) {
    assert.equal(safeReactionDiagnostic({ ...base, reason }).reason, undefined);
  }
  assert.equal(safeReactionDiagnostic({ ...base, reason: reasons[0], code: 'REACTION_REQUEST_FAILED' }).reason, undefined);
  assert.equal(safeReactionDiagnostic({ ...base, reason: reasons[0], phase: 'background-message' }).reason, undefined);
});

test('history and capability-gated transport retain only fixed reasons and safe incident fields', async () => {
  let stored = {};
  const history = createReactionFailureHistory({ storage: {
    get: async () => globalThis.structuredClone(stored), set: async value => { stored = globalThis.structuredClone(value); },
  } });
  const error = await cookieConflict({ value: 'other-cookie-secret' });
  await history.record({ ...reactionDiagnosticFromError(error, { requestId, operation: 'reaction' }), message: source, cookie: 'synthetic-cookie-secret',
    headers: [{ name: 'Authorization', value: 'synthetic-header-secret' }], account: 'synthetic-account' });
  const restored = (await history.snapshot())[0];
  assert.equal(restored.reason, reasons[0]);
  assert.doesNotMatch(JSON.stringify(stored), /private|secret|https|account|Authorization/);
  const requests = [];
  const transport = createDesktopTransport({ channel: 'dev', fetchImpl: async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return { ok: true, status: 202, json: async () => ({ ok: true, data: { recorded: true } }) };
  } });
  await transport.reactionFailure(credentials, { ...restored, url: source, value: 'synthetic-header-secret' });
  assert.equal(requests[0].reason, undefined);
  await transport.reactionFailure({ ...credentials, capabilities: [...credentials.capabilities, 'extension-diagnostics-reasons-v1'] },
    { ...restored, url: source, value: 'synthetic-header-secret' });
  assert.equal(requests[1].reason, reasons[0]);
  for (const request of requests) {
    assert.equal(request.delivered, undefined);
    assert.doesNotMatch(JSON.stringify(request), /private|secret|https|synthetic-account/);
  }
});
