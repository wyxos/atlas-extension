import assert from 'node:assert/strict';
import test from 'node:test';

import {
  postAssetReaction,
  postAssetReactionBatch,
} from '../src/content/atlas-api.js';

const runtimeContext = {
  cookies: [
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
  ],
  user_agent: 'AtlasExtensionRuntime/1.0',
};

test('posts asset reactions with runtime cookies and user agent', async () => {
  const requests = [];

  await postAssetReaction({
    asset: {
      source: 'https://video.twimg.com/ext_tw_video/example/pu/vid/1280x720/video.mp4',
      type: 'video',
    },
    config: {
      apiKey: 'local-key',
      domain: 'https://atlas.test',
    },
    downloadAction: 'force',
    fetchImpl: async (url, options) => {
      requests.push({ options, url });

      return {
        ok: true,
        async json() {
          return {
            reaction: { type: 'love' },
          };
        },
      };
    },
    reactionType: 'love',
    referrerUrl: 'https://x.com/example/status/1234567890',
    runtimeContext,
    source: 'x.com',
  });

  const body = JSON.parse(requests[0].options.body);

  assert.deepEqual(body.cookies, runtimeContext.cookies);
  assert.equal(body.user_agent, 'AtlasExtensionRuntime/1.0');
});

test('posts batch asset reactions with shared runtime cookies and user agent', async () => {
  const requests = [];

  await postAssetReactionBatch({
    config: {
      apiKey: 'local-key',
      domain: 'https://atlas.test',
    },
    downloadAction: 'force',
    fetchImpl: async (url, options) => {
      requests.push({ options, url });

      return {
        ok: true,
        async json() {
          return {
            items: [],
          };
        },
      };
    },
    items: [
      {
        asset: {
          source: 'https://video.twimg.com/ext_tw_video/example/pu/vid/1280x720/video.mp4',
          type: 'video',
        },
        referrerUrl: 'https://x.com/example/status/1234567890',
        source: 'x.com',
      },
    ],
    reactionType: 'love',
    runtimeContext,
  });

  const body = JSON.parse(requests[0].options.body);

  assert.deepEqual(body.cookies, runtimeContext.cookies);
  assert.equal(body.user_agent, 'AtlasExtensionRuntime/1.0');
});
