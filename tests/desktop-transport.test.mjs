import assert from 'node:assert/strict';
import test from 'node:test';

import {
  desktopBaseForChannel,
  desktopProtocolVersion,
} from '../src/shared/desktop-contract.js';
import { createDesktopTransport } from '../src/background/desktop-transport.js';

const credentials = {
  channel: 'dev',
  clientId: 'client-123',
  clientToken: 'token-456',
};

test('locks Dev and Stable builds to fixed loopback bases', () => {
  assert.equal(desktopBaseForChannel('dev'), 'http://127.0.0.1:17420');
  assert.equal(desktopBaseForChannel('stable'), 'http://127.0.0.1:37420');
});

test('accepts matching hello protocol and channel', async () => {
  const requests = [];
  const transport = createDesktopTransport({
    channel: 'dev',
    fetchImpl: createFetch(requests, helloData('dev')),
  });

  const hello = await transport.hello();

  assert.equal(hello.protocol_version, desktopProtocolVersion);
  assert.equal(requests[0].url, 'http://127.0.0.1:17420/v1/hello');
  assert.equal(requests[0].options.headers.Authorization, undefined);
});

test('hard rejects a Desktop channel mismatch', async () => {
  const transport = createDesktopTransport({
    channel: 'stable',
    fetchImpl: createFetch([], helloData('dev')),
  });

  await assert.rejects(transport.hello(), (error) => error.code === 'CHANNEL_MISMATCH');
});

test('pairs only after hello and sends the locked channel identity', async () => {
  const requests = [];
  const responses = [helloData('dev'), { client_id: 'new-client', client_token: 'new-token' }];
  const transport = createDesktopTransport({
    channel: 'dev',
    fetchImpl: createFetchSequence(requests, responses),
    runtime: {
      getManifest: () => ({ version: '1.2.3' }),
      getURL: () => 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/',
    },
  });

  const paired = await transport.pair();
  const body = JSON.parse(requests[1].options.body);

  assert.deepEqual(paired, { client_id: 'new-client', client_token: 'new-token' });
  assert.equal(body.expected_channel, 'dev');
  assert.equal(body.extension_origin, 'chrome-extension://abcdefghijklmnopabcdefghijklmnop');
  assert.equal(body.extension_version, '1.2.3');
  assert.equal(requests[1].options.headers.Authorization, undefined);
});

test('rejects pairing when the runtime does not expose an extension identity', async () => {
  const transport = createDesktopTransport({
    channel: 'dev',
    fetchImpl: createFetch([], helloData('dev')),
    runtime: { getManifest: () => ({ version: '1.2.3' }) },
  });

  await assert.rejects(
    transport.pair(),
    (error) => error.code === 'INVALID_EXTENSION_IDENTITY' && error.retryable === false,
  );
});

test('authenticates commands and adds idempotency keys only to mutations', async () => {
  const requests = [];
  const transport = createDesktopTransport({
    channel: 'dev',
    fetchImpl: createFetch(requests, { opened: true }),
  });

  await transport.openFile(credentials, 42, { idempotencyKey: 'idem-42' });

  assert.equal(requests[0].url, 'http://127.0.0.1:17420/v1/files/42/open');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer token-456');
  assert.equal(requests[0].options.headers['X-Atlas-Client-Id'], 'client-123');
  assert.equal(requests[0].options.headers['Idempotency-Key'], 'idem-42');
});

test('patches one Desktop-owned widget placement without replacing the policy', async () => {
  const requests = [];
  const transport = createDesktopTransport({
    channel: 'dev',
    fetchImpl: createFetch(requests, { revision: 4 }),
  });

  await transport.updateWidgetPlacement(credentials, {
    placement: { x_ratio: 0.25, y_ratio: 0.75 },
    site_domain: 'reddit.com',
  }, { idempotencyKey: 'placement-1' });

  assert.equal(requests[0].url, 'http://127.0.0.1:17420/v1/runtime-policy/widget-placement');
  assert.equal(requests[0].options.method, 'PUT');
  assert.equal(requests[0].options.headers['Idempotency-Key'], 'placement-1');
});

test('maps network failure to retryable Desktop offline semantics', async () => {
  const transport = createDesktopTransport({
    channel: 'dev',
    fetchImpl: async () => {
      throw new TypeError('fetch failed');
    },
  });

  await assert.rejects(transport.hello(), (error) => (
    error.code === 'DESKTOP_OFFLINE' && error.retryable === true
  ));
});

function helloData(channel) {
  return {
    app: { channel, version: '2.0.0' },
    capabilities: ['assets.status'],
    pairing_required: true,
    protocol_version: 1,
  };
}

function createFetch(requests, data) {
  return async (url, options) => {
    requests.push({ options, url });
    return response(data);
  };
}

function createFetchSequence(requests, data) {
  let index = 0;
  return async (url, options) => {
    requests.push({ options, url });
    const next = data[index];
    index += 1;
    return response(next, index === 2 ? 201 : 200);
  };
}

function response(data, status = 200) {
  return {
    json: async () => ({ data, ok: true, request_id: 'request-1' }),
    ok: status >= 200 && status < 300,
    status,
  };
}
