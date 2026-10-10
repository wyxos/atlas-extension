import assert from 'node:assert/strict';
import test from 'node:test';
import { browserActionObservations, browserActionTarget, normalizedBrowserActions, safeBrowserActionUrl } from '../src/content/browser-actions.js';
import { openBrowserContainerViaBackground } from '../src/content/background-api.js';
import { createDesktopTransport } from '../src/background/desktop-transport.js';
import { createDesktopRuntime } from '../src/background/desktop-runtime.js';
import { desktopMessageTypes } from '../src/shared/desktop-contract.js';

const pageUrl = 'https://unrecognized.example.test/models/123?version=456';
const action = { id: 'creator', label: 'Open creator in Atlas', selector: 'a[href]', target: 'link',
  pathPattern: '^/users/([A-Za-z0-9_-]+)$', containerType: 'user', sourceGroup: 1 };

test('safe action targets reject unsafe, cross-origin and credentialed links', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,x', 'https://other.test/users/a',
    'https://user:secret@unrecognized.example.test/users/a', '/users/a\n', '/users/a b']) {
    assert.equal(safeBrowserActionUrl(url, pageUrl), null);
  }
  assert.equal(safeBrowserActionUrl('/users/synthetic', pageUrl), 'https://unrecognized.example.test/users/synthetic');
  assert.equal(browserActionTarget(action, { getAttribute: () => '/unrelated' }, pageUrl), 'https://unrecognized.example.test/unrelated');
  assert.equal(browserActionTarget(action, { getAttribute: () => '/users/synthetic' }, pageUrl),
    'https://unrecognized.example.test/users/synthetic');
  assert.equal(browserActionTarget({ ...action, pathPattern: '[' }, { getAttribute: () => '/users/synthetic' }, pageUrl),
    'https://unrecognized.example.test/users/synthetic', 'path validation is owned by Desktop');
});

test('browser targets never access or execute provider regular expressions', () => {
  const malicious = { ...action, target: 'page', get pathPattern() { throw new Error('Browser evaluated an untrusted pattern'); } };
  assert.equal(browserActionTarget(malicious, null, pageUrl), pageUrl);
  assert.equal(browserActionTarget({ ...action, target: 'page', pathPattern: '^(a+)+$' }, null,
    `https://unrecognized.example.test/${'a'.repeat(2048)}!`).length, 2083);
});

test('URN observations are click-time, optional and bounded; URL parameters win', () => {
  const queryAction = { queryFilters: [{ parameter: 'modelVersionId', fallback: {
    selector: 'code', prefix: 'civitai:', format: 'model-urn' } }] };
  let text = 'civitai:2726029@3064584+2943406'; let reads = 0;
  const nodes = Array.from({ length: 9 }, (_, index) => ({ closest: () => null, matches: () => index === 0,
    get textContent() { reads++; return text; } }));
  const documentContext = { createTreeWalker() { let index = 0; return { nextNode: () => nodes[index++] ?? null }; } };
  assert.deepEqual(browserActionObservations(queryAction, documentContext, `${pageUrl}&modelVersionId=456`), []);
  const versionless = 'https://unrecognized.example.test/models/2726029';
  assert.deepEqual(browserActionObservations(queryAction, documentContext, versionless), [{ parameter: 'modelVersionId', value: text }]);
  assert.deepEqual(browserActionObservations(queryAction, documentContext, `${versionless}?modelVersionId=`), [{ parameter: 'modelVersionId', value: text }]);
  text = 'civitai:2726029@123';
  assert.equal(browserActionObservations(queryAction, documentContext, versionless)[0].value, text);
  text = 'civitai:' + '1'.repeat(129);
  assert.deepEqual(browserActionObservations(queryAction, documentContext, versionless), []);
  text = 'unexpected:2726029@123';
  assert.deepEqual(browserActionObservations(queryAction, documentContext, versionless), []);
  assert.equal(reads, 5);
  let count = 0;
  const boundedDocument = { createTreeWalker() { return { nextNode: () => ({ closest: () => null, matches: () => true,
    get textContent() { assert.ok(++count <= 8); return 'civitai:1@1'; } }) }; } };
  assert.equal(browserActionObservations(queryAction, boundedDocument, versionless).length, 1);
  assert.equal(count, 8);
});

test('page actions retain model version query while matching the pathname', () => {
  assert.equal(browserActionTarget({ ...action, target: 'page', pathPattern: '^/models/[0-9]+$' }, null, pageUrl), pageUrl);
});

test('provider action processing is declarative, bounded and requires package identity', () => {
  assert.deepEqual(normalizedBrowserActions({ actions: [action] }), []);
  assert.deepEqual(normalizedBrowserActions({ provider: 'unknown', profileVersion: '1@digest', actions: [action] }), [action]);
  const actions = Array.from({ length: 1000 }, () => action);
  Object.defineProperty(actions, 16, { get() { throw new Error('unbounded action read'); } });
  assert.equal(normalizedBrowserActions({ provider: 'unknown', profileVersion: '1@digest', actions }).length, 16);
  assert.equal(normalizedBrowserActions({ provider: 'unknown', profileVersion: '1@digest', actions: [{ ...action, target: 'execute' }] }).length, 0);
});

test('content worker message and runtime preserve package identity and exact URLs', async () => {
  const messages = [];
  const observations = [{ parameter: 'modelVersionId', value: 'civitai:123@456' }];
  const opened = await openBrowserContainerViaBackground({ pageUrl, targetUrl: pageUrl, provider: 'unknown',
    profileVersion: '1@digest', actionId: 'model', observations, runtime: { sendMessage(message, callback) {
      messages.push(message); callback({ ok: true, payload: { opened: true } });
    } } });
  assert.equal(opened.opened, true);
  assert.equal(messages[0].type, desktopMessageTypes.openBrowserContainer);
  const credentials = { channel: 'dev', clientId: 'fixture-client', clientToken: 'fixture-token',
    capabilities: ['browser-container-actions-v1'] };
  let received;
  const runtime = createDesktopRuntime({ storage: { async get() { return { atlasDesktopConnection: credentials }; } },
    transport: { async openBrowserContainer(saved, body) { assert.equal(saved.clientId, credentials.clientId); received = body; return { opened: true }; } } });
  const reply = await new Promise(resolve => assert.equal(runtime.handleMessage(messages[0], resolve), true));
  assert.equal(reply.ok, true);
  assert.deepEqual(received, { page_url: pageUrl, target_url: pageUrl, provider: 'unknown',
    profile_version: '1@digest', action_id: 'model', observations });
  credentials.capabilities = [];
  const unsupported = await new Promise(resolve => runtime.handleMessage(messages[0], resolve));
  assert.equal(unsupported.error.code, 'DESKTOP_CAPABILITY_REQUIRED');
});

test('transport authenticates container actions, marks mutation and gates older Desktop', async () => {
  const requests = [];
  const transport = createDesktopTransport({ fetchImpl: async (url, options) => {
    requests.push({ url, options }); return { ok: true, async json() { return { ok: true, data: { opened: true } }; } };
  } });
  const credentials = { channel: 'dev', clientId: 'fixture-client', clientToken: 'fixture-token' };
  assert.throws(() => transport.openBrowserContainer(credentials, {}), { code: 'DESKTOP_CAPABILITY_REQUIRED' });
  assert.equal(requests.length, 0);
  await transport.openBrowserContainer({ ...credentials, capabilities: ['browser-container-actions-v1'] }, { page_url: pageUrl });
  assert.equal(requests[0].url, 'http://127.0.0.1:17420/v1/browser/open-container');
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer fixture-token');
  assert.ok(requests[0].options.headers['Idempotency-Key']);
});
