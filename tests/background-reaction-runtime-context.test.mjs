import assert from 'node:assert/strict';
import test from 'node:test';

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
