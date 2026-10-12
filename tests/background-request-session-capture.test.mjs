import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequestSessionCapture } from '../src/background/request-session-capture.js';

const url = 'https://cdn.test/media.mp4?signature=synthetic';
function capture(cache, overrides = {}) {
  cache.observe({ tabId: 4, requestId: 'one', method: 'GET', url,
    requestHeaders: [{ name: 'Authorization', value: 'Bearer synthetic' }, { name: 'Origin', value: 'https://site.test' },
      { name: 'Referer', value: 'https://site.test/page' }, { name: 'X-Media-Token', value: 'synthetic' },
      ...['Cookie', 'Host', 'Range', 'Accept-Encoding', 'Proxy-Authorization', 'Sec-Fetch-Site', 'X-Forwarded-For']
        .map(name => ({ name, value: 'excluded' }))], ...overrides });
  cache.complete({ requestId: overrides.requestId ?? 'one', statusCode: 206 });
}
function acceptedPage(cache, details) {
  const requestId = Symbol('trusted-request');
  cache.observe({ ...details, requestId, method: 'GET', type: 'xmlhttprequest', requestHeaders: [] });
  cache.complete({ requestId, statusCode: 200 });
  cache.observePage(details);
}

function overlappingRequests(cache, topHeaders, frameHeaders, frameFirst = false) {
  const records = [
    { tabId: 4, frameId: 0, documentId: 'top', url, headers: topHeaders },
    { tabId: 4, frameId: 7, documentId: 'selected', url, headers: frameHeaders },
  ];
  for (const record of frameFirst ? records.toReversed() : records) acceptedPage(cache, record);
}

const selectedScope = { frameId: 7, documentId: 'selected', topPageUrl: url };

test('ordinary page/frame header differences retain the sending document request without merging', () => {
  const credentials = [{ name: 'Authorization', value: 'Bearer synthetic' }, { name: 'X-Media-Token', value: 'synthetic' }];
  const topHeaders = [...credentials, { name: 'Accept', value: 'text/html' }, { name: 'Accept-Language', value: 'en' },
    { name: 'Origin', value: 'https://top.test' }, { name: 'Referer', value: 'https://top.test/page' },
    { name: 'User-Agent', value: 'synthetic-top' }];
  const frameHeaders = [...credentials.toReversed(), { name: 'Accept', value: '*/*' },
    { name: 'Origin', value: 'https://frame.test' }, { name: 'Referer', value: 'https://frame.test/page' },
    { name: 'User-Agent', value: 'synthetic-frame' }];
  for (const frameFirst of [false, true]) {
    const cache = createRequestSessionCapture({ now: () => 1000 });
    overlappingRequests(cache, topHeaders, frameHeaders, frameFirst);
    assert.deepEqual(cache.snapshot(4, [url], selectedScope), [{ url,
      headers: frameHeaders.map(header => ({ ...header, name: header.name.toLowerCase() })),
    }]);
  }
});

test('header ordering alone cannot make an otherwise identical session ambiguous', () => {
  const headers = [{ name: 'Authorization', value: 'Bearer synthetic' },
    { name: 'X-Session', value: 'synthetic' }, { name: 'Accept', value: '*/*' }];
  const cache = createRequestSessionCapture({ now: () => 1000 });
  overlappingRequests(cache, headers, headers.toReversed());
  assert.deepEqual(cache.snapshot(4, [url], selectedScope), [{ url,
    headers: headers.toReversed().map(header => ({ ...header, name: header.name.toLowerCase() })),
  }]);
});

test('different or missing authorization and opaque custom headers remain ambiguous', () => {
  const credentials = [{ name: 'Authorization', value: 'Bearer synthetic' }, { name: 'X-Custom', value: 'synthetic' }];
  const conflicts = [
    [{ ...credentials[0], value: 'Bearer other' }, credentials[1]],
    [credentials[0], { ...credentials[1], value: 'other' }],
    [credentials[0]], [credentials[1]], [],
    [...credentials, { name: 'X-Unknown', value: 'extra' }],
    [...credentials, { name: 'Authorization', value: 'Bearer other' }],
  ];
  for (const conflicting of conflicts) {
    for (const frameFirst of [false, true]) {
      const cache = createRequestSessionCapture({ now: () => 1000 });
      overlappingRequests(cache, credentials, conflicting, frameFirst);
      assert.throws(() => cache.snapshot(4, [url], selectedScope), { code: 'BROWSER_SESSION_AMBIGUOUS' });
    }
  }
});

test('harmless differences cannot hide invalid or expired overlapping requests', () => {
  for (const frameFirst of [false, true]) {
    const cache = createRequestSessionCapture({ now: () => 1000 });
    overlappingRequests(cache, [{ name: 'Accept', value: 'unsafe\r\nheader' }], [{ name: 'Accept', value: '*/*' }], frameFirst);
    assert.throws(() => cache.snapshot(4, [url], selectedScope), { code: 'BROWSER_SESSION_HEADERS_INVALID' });
  }
  let time = 1000;
  const cache = createRequestSessionCapture({ now: () => time, maxAgeMs: 100 });
  acceptedPage(cache, { tabId: 4, frameId: 0, documentId: 'top', url, headers: [{ name: 'Accept', value: 'text/html' }] });
  time += 101;
  acceptedPage(cache, { tabId: 4, frameId: 7, documentId: 'selected', url, headers: [{ name: 'Accept', value: '*/*' }] });
  assert.throws(() => cache.snapshot(4, [url], selectedScope), { code: 'BROWSER_SESSION_EXPIRED' });
});

test('captures accepted tab requests and forwards credentials only to the exact signed URL', () => {
  const cache = createRequestSessionCapture();
  capture(cache);
  const result = cache.snapshot(4, [url + '#playing']);
  assert.deepEqual(result, [{ url, headers: [
    { name: 'authorization', value: 'Bearer synthetic' }, { name: 'origin', value: 'https://site.test' },
    { name: 'referer', value: 'https://site.test/page' }, { name: 'x-media-token', value: 'synthetic' },
  ] }]);
  assert.deepEqual(cache.snapshot(5, [url]), []);
  assert.deepEqual(cache.snapshot(4, ['https://cdn.test/other', url + 'changed', 'https://other.test/media.mp4']), []);
  result[0].headers[0].value = 'mutated';
  assert.equal(cache.snapshot(4, [url])[0].headers[0].value, 'Bearer synthetic');
});

test('failed, pending, POST and background requests do not supply download authentication', () => {
  const cache = createRequestSessionCapture();
  const details = { tabId: 4, requestId: 'one', method: 'GET', url,
    requestHeaders: [{ name: 'Authorization', value: 'synthetic' }] };
  cache.observe(details);
  assert.deepEqual(cache.snapshot(4, [url]), []);
  cache.complete({ requestId: 'one', statusCode: 474 });
  assert.deepEqual(cache.snapshot(4, [url]), []);
  capture(cache, { method: 'POST' });
  capture(cache, { tabId: -1 });
  assert.deepEqual(cache.snapshot(4, [url]), []);
});

test('bounded cache evicts old entries, clears retired tabs and rejects stale or invalid captured headers', () => {
  let time = 1000;
  const cache = createRequestSessionCapture({ maxTabs: 1, maxRequestsPerTab: 1, maxAgeMs: 100, now: () => time });
  capture(cache);
  capture(cache, { url: 'https://cdn.test/new' });
  assert.deepEqual(cache.snapshot(4, [url]), []);
  capture(cache, { tabId: 5 });
  assert.deepEqual(cache.snapshot(4, ['https://cdn.test/new']), []);
  time += 101;
  assert.throws(() => cache.snapshot(5, [url]), { code: 'BROWSER_SESSION_EXPIRED' });
  cache.removeTab(5);
  assert.deepEqual(cache.snapshot(5, [url]), []);
  capture(cache, { requestHeaders: [{ name: 'Authorization', value: 'synthetic\r\nCookie: unsafe' }] });
  assert.throws(() => cache.snapshot(4, [url]), { code: 'BROWSER_SESSION_HEADERS_INVALID' });
  const tiny = createRequestSessionCapture({ maxBytes: 4 });
  capture(tiny);
  assert.deepEqual(tiny.snapshot(4, [url]), []);
});

test('binds real event flow, captures ongoing accepted media and clears top-level navigation', () => {
  const cache = createRequestSessionCapture();
  const events = {};
  const event = name => ({ addListener: (handler, filter, options) => { events[name] = { handler, filter, options }; } });
  cache.bind({ webRequest: Object.fromEntries(['onBeforeRequest', 'onBeforeSendHeaders', 'onResponseStarted',
    'onBeforeRedirect', 'onErrorOccurred'].map(name => [name, event(name)])), tabs: { onRemoved: event('removed') } });
  assert.deepEqual(events.onBeforeSendHeaders.options, ['requestHeaders', 'extraHeaders']);
  events.onBeforeSendHeaders.handler({ tabId: 4, requestId: 'one', method: 'GET', url,
    requestHeaders: [{ name: 'Authorization', value: 'synthetic' }] });
  events.onResponseStarted.handler({ requestId: 'one', statusCode: 200 });
  assert.equal(cache.snapshot(4, [url]).length, 1);
  events.onBeforeRequest.handler({ tabId: 4, type: 'sub_frame' });
  assert.equal(cache.snapshot(4, [url]).length, 1);
  events.onBeforeRequest.handler({ tabId: 4, type: 'main_frame' });
  assert.deepEqual(cache.snapshot(4, [url]), []);
});

test('same tab media URL keeps independent frame and document credentials, including page observations', () => {
  const cache = createRequestSessionCapture();
  acceptedPage(cache, { tabId: 4, frameId: 1, documentId: 'a', url, headers: [{ name: 'Authorization', value: 'Bearer a' }] });
  acceptedPage(cache, { tabId: 4, frameId: 2, documentId: 'b', url, headers: [{ name: 'Authorization', value: 'Bearer b' }] });
  acceptedPage(cache, { tabId: 4, frameId: 1, documentId: 'new-a', url, headers: [{ name: 'Authorization', value: 'Bearer new-a' }] });
  const token = scope => cache.snapshot(4, [url], scope)[0].headers[0].value;
  assert.equal(token({ frameId: 1, documentId: 'a' }), 'Bearer a');
  assert.equal(token({ frameId: 2, documentId: 'b' }), 'Bearer b');
  assert.equal(token({ frameId: 1, documentId: 'new-a' }), 'Bearer new-a');
  assert.deepEqual(cache.snapshot(4, [url], { frameId: 1, documentId: 'unknown' }), []);
});

test('handoff retains observed cross-host HLS fragments and API credentials from the sending document only', () => {
  const cache = createRequestSessionCapture();
  const root = 'https://manifest.test/clip.m3u8', fragment = 'https://fragments.test/part.ts';
  acceptedPage(cache, { tabId: 4, frameId: 7, documentId: 'selected', url: root,
    headers: [{ name: 'Authorization', value: 'Bearer manifest' }] });
  cache.observe({ tabId: 4, frameId: 7, documentId: 'selected', requestId: 'fragment', url: fragment,
    type: 'media', method: 'GET', requestHeaders: [{ name: 'X-Media-Token', value: 'fragment-token' }] });
  cache.complete({ requestId: 'fragment', statusCode: 206 });
  acceptedPage(cache, { tabId: 4, frameId: 8, documentId: 'unrelated', url: 'https://other.test/private-api',
    headers: [{ name: 'Authorization', value: 'Bearer unrelated' }] });
  const result = cache.snapshot(4, [root], { frameId: 7, documentId: 'selected' });
  assert.deepEqual(result.map(scope => scope.url), [root, fragment]);
  assert.equal(result[1].headers[0].value, 'fragment-token');
});

test('stale ancillary API traffic cannot block a newly authenticated file but stale selected roots fail explicitly', () => {
  let time = 1000;
  const cache = createRequestSessionCapture({ now: () => time, maxAgeMs: 100 });
  acceptedPage(cache, { tabId: 4, url: 'https://site.test/old-api', headers: [{ name: 'Authorization', value: 'Bearer expired' }] });
  time += 101;
  acceptedPage(cache, { tabId: 4, url, headers: [{ name: 'Authorization', value: 'Bearer fresh' }] });
  assert.deepEqual(cache.snapshot(4, [url]).map(scope => scope.url), [url]);
  assert.throws(() => cache.snapshot(4, ['https://site.test/old-api']), { code: 'BROWSER_SESSION_EXPIRED' });
});

test('forged page events cannot authorize unrelated cookie URLs without matching browser success', () => {
  const cache = createRequestSessionCapture();
  const forged = { tabId: 4, frameId: 2, documentId: 'selected', url: 'https://unrelated.test/private-api',
    headers: [{ name: 'Authorization', value: 'forged-token' }] };
  cache.observePage(forged);
  assert.deepEqual(cache.snapshot(4, [url], { frameId: 2, documentId: 'selected' }), []);
  const requestId = 'actual';
  cache.observe({ ...forged, requestId, method: 'GET', type: 'xmlhttprequest', requestHeaders: [] });
  cache.complete({ requestId, statusCode: 474 });
  assert.deepEqual(cache.snapshot(4, [url], { frameId: 2, documentId: 'selected' }), []);
  cache.observe({ ...forged, requestId, method: 'GET', type: 'xmlhttprequest', requestHeaders: [] });
  cache.complete({ requestId, statusCode: 200 });
  assert.equal(cache.snapshot(4, [url], { frameId: 2, documentId: 'selected' })[0].url, forged.url);
  assert.deepEqual(cache.snapshot(4, [url], { frameId: 3, documentId: 'selected' }), []);
});

test('page observation delivered before response completion merges only with browser-authorized matching frame/document', () => {
  const cache = createRequestSessionCapture({ now: () => 1000 });
  cache.observePage({ tabId: 4, frameId: 7, documentId: 'selected', url,
    headers: [{ name: 'Authorization', value: 'Bearer synthetic' }, { name: 'X-Media-Token', value: 'forged-visible-header' }] });
  cache.observe({ tabId: 4, frameId: 7, documentId: 'selected', requestId: 'one', url, method: 'GET', type: 'media',
    requestHeaders: [{ name: 'X-Media-Token', value: 'actual-browser-token' }] });
  cache.complete({ requestId: 'one', statusCode: 200 });
  assert.deepEqual(cache.snapshot(4, [url], { frameId: 7, documentId: 'selected' })[0].headers, [
    { name: 'authorization', value: 'Bearer synthetic' }, { name: 'x-media-token', value: 'actual-browser-token' },
  ]);
});
