import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequestSessionCapture } from '../src/background/request-session-capture.js';

import {
  collectCookiesForUrls,
  collectReactionRuntimeContext,
} from '../src/background/reaction-runtime-context.js';

test('collects normalized unique browser cookies for reaction URLs', async () => {
  const calls = [];
  const chromeApi = {
    cookies: {
      getAll(options, callback) {
        calls.push(options);
        callback([
          {
            domain: ' X.COM ',
            expirationDate: 1893456000.9,
            hostOnly: false,
            httpOnly: true,
            name: ' auth_token ',
            path: '',
            secure: true,
            value: 'test-token',
          },
          {
            domain: 'x.com',
            expirationDate: 1893456000.1,
            hostOnly: false,
            httpOnly: true,
            name: 'auth_token',
            path: '/',
            secure: true,
            value: 'test-token',
          },
          {
            domain: 'x.com',
            name: '',
            value: 'ignored',
          },
        ]);
      },
    },
    runtime: {
      lastError: null,
    },
  };

  assert.deepEqual(await collectCookiesForUrls([
    'https://x.com/example/status/123',
    'https://x.com/example/status/123#media',
  ], { chromeApi }), [
    {
      domain: 'x.com',
      expires_at: 1893456000,
      host_only: false,
      http_only: true,
      name: 'auth_token',
      path: '/',
      secure: true,
      value: 'test-token',
    },
  ]);
  assert.deepEqual(calls, [
    { url: 'https://x.com/example/status/123' },
  ]);
});

test('builds reaction runtime context from asset and referrer URLs', async () => {
  const requestedUrls = [];
  const chromeApi = {
    cookies: {
      getAll(options, callback) {
        requestedUrls.push(options.url);
        callback([
          {
            domain: 'x.com',
            hostOnly: false,
            httpOnly: true,
            name: 'auth_token',
            path: '/',
            secure: true,
            value: 'test-token',
          },
        ]);
      },
    },
    runtime: {
      lastError: null,
    },
  };

  const context = await collectReactionRuntimeContext({
    asset: {
      source: 'https://video.twimg.com/ext_tw_video/example/pu/vid/1280x720/video.mp4',
    },
    reactionType: 'love',
    referrerUrl: 'https://x.com/example/status/1234567890',
  }, {
    chromeApi,
    userAgent: 'AtlasExtensionRuntime/1.0',
  });

  assert.equal(context.user_agent, 'AtlasExtensionRuntime/1.0');
  assert.equal(context.cookies.length, 1);
  assert.deepEqual(requestedUrls, [
    'https://video.twimg.com/ext_tw_video/example/pu/vid/1280x720/video.mp4',
    'https://x.com/example/status/1234567890',
  ]);
});

test('omits cookies for blacklist reactions while keeping the user agent', async () => {
  const chromeApi = {
    cookies: {
      getAll() {
        throw new Error('cookies should not be read');
      },
    },
    runtime: {
      lastError: null,
    },
  };

  assert.deepEqual(await collectReactionRuntimeContext({
    asset: {
      source: 'https://video.twimg.com/ext_tw_video/example/pu/vid/1280x720/video.mp4',
    },
    reactionType: 'blacklist',
    referrerUrl: 'https://x.com/example/status/1234567890',
  }, {
    chromeApi,
    userAgent: 'AtlasExtensionRuntime/1.0',
  }), {
    user_agent: 'AtlasExtensionRuntime/1.0',
  });
});

test('uses the originating incognito cookie store and actual frame partition without persisting store or tab IDs', async () => {
  const calls = [];
  const partitionKey = { topLevelSite: 'https://site.test', hasCrossSiteAncestor: true };
  const chromeApi = { cookies: {
    getAllCookieStores: done => done([{ id: 'regular', tabIds: [1] }, { id: 'private', tabIds: [4] }]),
    getPartitionKey: async details => { assert.deepEqual(details, { tabId: 4, frameId: 7 }); return { partitionKey }; },
    getAll: (details, done) => { calls.push(details); done([{ name: 'session', value: details.partitionKey ? 'partition' : 'unpartitioned',
      domain: '.cdn.test', path: '/media', hostOnly: false, httpOnly: true, secure: true,
      ...(details.partitionKey ? { partitionKey } : {}), expirationDate: 2000000000 }]); },
  } };
  const url = 'https://cdn.test/media/video.mp4?signature=synthetic';
  const context = await collectReactionRuntimeContext({ asset: { source: url }, reactionType: 'like' }, {
    chromeApi, tabId: 4, frameId: 7, now: () => 100000,
    requestCapture: { snapshot: (tabId, urls) => { assert.equal(tabId, 4); assert.equal(urls[0], url); return [];} },
  });
  assert.deepEqual(calls, [{ url, storeId: 'private' }, { url, storeId: 'private', partitionKey }]);
  assert.equal(context.cookies.length, 1);
  assert.equal(context.cookies[0].value, 'partition');
  assert.deepEqual(context.cookies[0].partition_key, { top_level_site: 'https://site.test', has_cross_site_ancestor: true });
  assert.equal(context.cookies[0].http_only, true);
  assert.deepEqual(context.browser_session, { version: 1, captured_at: 100, cookie_scope: {
    partition_supported: true, top_level_site: 'https://site.test', has_cross_site_ancestor: true,
  }, request_headers: [] });
  assert.equal(JSON.stringify(context).includes('private'), false);
});

test('older browser session explicitly reports absent partition support and still uses the correct store', async () => {
  const context = await collectReactionRuntimeContext({ asset: { source: 'https://site.test/video' } }, {
    tabId: 2, chromeApi: { cookies: { getAllCookieStores: done => done([{ id: 'one', tabIds: [2] }]),
      getAll: (details, done) => { assert.equal(details.storeId, 'one'); done([]); } } },
  });
  assert.equal(context.browser_session.cookie_scope.partition_supported, false);
});

test('cookie access failures reject safely rather than producing anonymous downloads', async () => {
  const message = { asset: { source: 'https://site.test/video' } };
  for (const chromeApi of [{}, { cookies: { getAll: () => { throw new Error('sensitive failure'); } } },
    { cookies: { getAll: (_, done) => done(undefined) } },
    { runtime: { lastError: { message: 'sensitive failure' } }, cookies: { getAll: (_, done) => done([]) } }]) {
    await assert.rejects(collectReactionRuntimeContext(message, { chromeApi }), error => {
      assert.equal(error.code, 'BROWSER_SESSION_UNAVAILABLE');
      assert.equal(error.message.includes('sensitive'), false);
      return true;
    });
  }
  await assert.rejects(collectReactionRuntimeContext(message, { requireTab: true }), { code: 'BROWSER_SESSION_UNAVAILABLE' });
  await assert.rejects(collectReactionRuntimeContext(message, { tabId: 2,
    chromeApi: { cookies: { getAllCookieStores: done => done([{ id: 'wrong', tabIds: [3] }]) } },
  }), { code: 'BROWSER_SESSION_UNAVAILABLE' });
  await assert.rejects(collectReactionRuntimeContext(message, { tabId: 2, chromeApi: { cookies: {
    getAllCookieStores: done => done([{ id: 'one', tabIds: [2] }]),
    getPartitionKey: async () => { throw new Error('sensitive failure'); },
  } } }), { code: 'BROWSER_SESSION_UNAVAILABLE' });
});

test('foreign cookie partitions are excluded and conflicting same-scope cookies cannot pick a random login', async () => {
  const partitionKey = { topLevelSite: 'https://site.test', hasCrossSiteAncestor: false };
  const session = { name: 'session', value: 'first', domain: 'cdn.test', path: '/' };
  const chromeApi = { cookies: {
    getAllCookieStores: done => done([{ id: 'selected', tabIds: [2] }]),
    getPartitionKey: async () => ({ partitionKey }),
    getAll: (details, done) => done(details.partitionKey ? [{ ...session, value: 'foreign',
      partitionKey: { ...partitionKey, topLevelSite: 'https://other.test' } }] : [session]),
  } };
  const urls = ['https://cdn.test/media'];
  assert.equal((await collectCookiesForUrls(urls, { chromeApi, tabId: 2 }))[0].value, 'first');
  chromeApi.cookies.getAll = (_, done) => done([session, { ...session, value: 'other-login' }]);
  await assert.rejects(collectCookiesForUrls(urls, { chromeApi, tabId: 2 }), { code: 'BROWSER_SESSION_AMBIGUOUS' });
});

test('one verified header snapshot also collects cross-host and API path cookies from the sending store', async () => {
  const root = 'https://site.test/watch', fragment = 'https://cdn.test/media/fragment.ts', api = 'https://site.test/api/media';
  const requests = [];
  let snapshots = 0;
  const records = [{ url: fragment, headers: [{ name: 'x-media-token', value: 'synthetic' }] }, { url: api, headers: [] }];
  const chromeApi = { cookies: {
    getAllCookieStores: done => done([{ id: 'selected', tabIds: [2] }]),
    getAll: (details, done) => {
      requests.push(details);
      const cookies = details.url === fragment ? [{ name: 'fragment_session', domain: 'cdn.test', path: '/media/', value: 'fragment', httpOnly: true }]
        : details.url === api ? [{ name: 'api_session', domain: 'site.test', path: '/api/', value: 'api', httpOnly: true }] : [];
      done(cookies);
    },
  } };
  const context = await collectReactionRuntimeContext({ asset: { source: root }, reactionType: 'like' }, {
    chromeApi, tabId: 2, requestCapture: { snapshot: () => { snapshots++; return records; } },
  });
  assert.equal(snapshots, 1);
  assert.deepEqual(requests, [root, fragment, api].map(url => ({ url, storeId: 'selected' })));
  assert.deepEqual(context.cookies.map(cookie => [cookie.name, cookie.domain, cookie.path, cookie.http_only]), [
    ['fragment_session', 'cdn.test', '/media/', true], ['api_session', 'site.test', '/api/', true],
  ]);
  assert.deepEqual(context.browser_session.request_headers, records);
});

test('forged unobserved page scope never authorizes another domain cookie read', async () => {
  const capture = createRequestSessionCapture();
  capture.observePage({ tabId: 2, frameId: 7, documentId: 'selected', url: 'https://unrelated.test/private',
    headers: [{ name: 'authorization', value: 'forged' }] });
  const requests = [];
  await collectReactionRuntimeContext({ asset: { source: 'https://site.test/media' } }, {
    tabId: 2, frameId: 7, documentId: 'selected', requestCapture: capture,
    chromeApi: { cookies: { getAllCookieStores: done => done([{ id: 'selected', tabIds: [2] }]),
      getAll: (details, done) => { requests.push(details.url); done([]); } } },
  });
  assert.deepEqual(requests, ['https://site.test/media']);
});
