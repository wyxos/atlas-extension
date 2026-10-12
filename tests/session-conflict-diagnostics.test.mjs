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
    assert.deepEqual(error.details, { reason: reasons[index], ...(index === 1 ? { cookieFlags: ['SECURE'] } : {}) });
    assert.doesNotMatch(JSON.stringify(error.details), /secret|private|example|https|selected/);
  }
});

test('cookie flag diagnostics identify every differing flag without exposing values or weakening isolation', async () => {
  // Host-only is now part of identity; differing scopes are preserved instead
  // of reported as conflicting attributes. Legacy HOST_ONLY labels stay valid.
  const flags = [['secure', 'SECURE'], ['httpOnly', 'HTTP_ONLY']];
  for (let mask = 1; mask < 4; mask++) {
    const selected = flags.filter((_flag, index) => mask & (1 << index));
    const error = await cookieConflict(Object.fromEntries(selected.map(([field]) => [field, false])));
    assert.equal(error.code, 'BROWSER_SESSION_AMBIGUOUS');
    assert.deepEqual(error.details, { reason: reasons[1], cookieFlags: selected.map(([, flag]) => flag) });
    const diagnostic = reactionDiagnosticFromError(error, { requestId });
    assert.deepEqual(diagnostic.cookieFlags, selected.map(([, flag]) => flag));
    assert.doesNotMatch(JSON.stringify(diagnostic), /private|secret|https|selected|true|false/);
  }
  const valueError = await cookieConflict({ value: 'other-cookie-secret', secure: false, httpOnly: false });
  assert.deepEqual(valueError.details, { reason: reasons[0] });
});

test('cookie flag sanitizer accepts only bounded distinct fixed labels with the security reason', () => {
  const event = { ...base, reason: reasons[1] };
  assert.deepEqual(safeReactionDiagnostic({ ...event, cookieFlags: ['HOST_ONLY', 'SECURE'] }).cookieFlags, ['SECURE', 'HOST_ONLY']);
  for (const cookieFlags of [null, [], Object.assign([], { length: 1 }), ['SECURE', 'SECURE'], ['SECURE', 'HTTP_ONLY', 'HOST_ONLY', 'SECURE'],
    ['synthetic-cookie-name'], [source], ['SECURE', { value: 'synthetic-cookie-secret' }], 'SECURE']) {
    assert.equal(safeReactionDiagnostic({ ...event, cookieFlags }).cookieFlags, undefined);
  }
  for (const invalid of [{ reason: reasons[0] }, { phase: 'sending-request' }, { code: 'REACTION_REQUEST_FAILED' }]) {
    assert.equal(safeReactionDiagnostic({ ...event, ...invalid, cookieFlags: ['SECURE'] }).cookieFlags, undefined);
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
  const error = await cookieConflict({ secure: false, httpOnly: false });
  await history.record({ ...reactionDiagnosticFromError(error, { requestId, operation: 'reaction' }), message: source, cookie: 'synthetic-cookie-secret',
    headers: [{ name: 'Authorization', value: 'synthetic-header-secret' }], account: 'synthetic-account' });
  const restored = (await history.snapshot())[0];
  assert.equal(restored.reason, reasons[1]);
  assert.deepEqual(restored.cookieFlags, ['SECURE', 'HTTP_ONLY']);
  assert.doesNotMatch(JSON.stringify(stored), /private|secret|https|account|Authorization/);
  const requests = [];
  const transport = createDesktopTransport({ channel: 'dev', fetchImpl: async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return { ok: true, status: 202, json: async () => ({ ok: true, data: { recorded: true } }) };
  } });
  await transport.reactionFailure(credentials, { ...restored, url: source, value: 'synthetic-header-secret' });
  assert.equal(requests[0].reason, undefined);
  assert.equal(requests[0].cookieFlags, undefined);
  await transport.reactionFailure({ ...credentials, capabilities: [...credentials.capabilities, 'extension-diagnostics-reasons-v1'] },
    { ...restored, url: source, value: 'synthetic-header-secret' });
  assert.equal(requests[1].reason, reasons[1]);
  assert.equal(requests[1].cookieFlags, undefined);
  await transport.reactionFailure({ ...credentials, capabilities: [...credentials.capabilities,
    'extension-diagnostics-reasons-v1', 'extension-diagnostics-cookie-flags-v1'] }, restored);
  assert.deepEqual(requests[2].cookieFlags, ['SECURE', 'HTTP_ONLY']);
  await transport.reactionFailure({ ...credentials, capabilities: [...credentials.capabilities,
    'extension-diagnostics-cookie-flags-v1'] }, restored);
  assert.equal(requests[3].reason, undefined);
  assert.equal(requests[3].cookieFlags, undefined);
  for (const request of requests) {
    assert.equal(request.delivered, undefined);
    assert.doesNotMatch(JSON.stringify(request), /private|secret|https|synthetic-account/);
  }
});
