import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deleteAtlasFile,
  fetchAssetStatuses,
  loadAtlasContentConfig,
  postAssetReactionBatch,
  postAssetReaction,
} from '../src/content/atlas-api.js';
import {
  connectionModes,
  connectionStatuses,
  localApiKey,
  localDomain,
} from '../src/options/connection.js';

test('loads content config from the active stored connection profile', async () => {
  assert.deepEqual(await loadAtlasContentConfig({
    async get() {
      return {};
    },
  }), {
    apiKey: '',
    domain: '',
    mode: connectionModes.live,
    status: connectionStatuses.idle,
  });

  assert.deepEqual(await loadAtlasContentConfig({
    get(key, callback) {
      callback({
        [key]: {
          apiKey: 'stored-key',
          domain: 'https://stored.example.test',
          status: connectionStatuses.failed,
        },
      });
    },
  }), {
    apiKey: 'stored-key',
    domain: 'https://stored.example.test',
    mode: connectionModes.live,
    status: connectionStatuses.failed,
  });

  assert.deepEqual(await loadAtlasContentConfig({
    get(key, callback) {
      callback({
        [key]: {
          mode: connectionModes.local,
          profiles: {
            live: {
              apiKey: 'stored-key',
              domain: 'https://stored.example.test',
              status: connectionStatuses.connected,
            },
            local: {
              status: connectionStatuses.connected,
            },
          },
          version: 2,
        },
      });
    },
  }), {
    apiKey: localApiKey,
    domain: localDomain,
    mode: connectionModes.local,
    status: connectionStatuses.connected,
  });

  assert.deepEqual(await loadAtlasContentConfig({
    get() {},
  }, {
    storageTimeoutMs: 1,
  }), {
    apiKey: '',
    domain: '',
    mode: connectionModes.live,
    status: connectionStatuses.idle,
  });
});

test('posts asset reactions to the extension endpoint', async () => {
  const requests = [];
  const response = await postAssetReaction({
    asset: {
      resolution: '1280x720',
      source: 'https://cdn.example.test/media/art.jpg',
      type: 'image',
    },
    config: {
      apiKey: 'local-key',
      domain: 'https://atlas.test',
    },
    fetchImpl: async (url, options) => {
      requests.push({ options, url });

      return {
        ok: true,
        async json() {
          return {
            asset_url: 'https://cdn.example.test/media/art.jpg',
            reaction: { type: 'like' },
          };
        },
      };
    },
    reactionType: 'like',
    referrerUrl: 'https://www.example.test/post/123',
    source: 'example.test',
  });

  assert.equal(response.reaction.type, 'like');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://atlas.test/api/extension/reactions');
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(requests[0].options.headers['X-Atlas-Api-Key'], 'local-key');

  const body = JSON.parse(requests[0].options.body);
  assert.deepEqual(body, {
    asset_url: 'https://cdn.example.test/media/art.jpg',
    metadata: {
      asset_type: 'image',
      resolution: '1280x720',
    },
    referrer_url: 'https://www.example.test/post/123',
    source: 'example.test',
    type: 'like',
  });
});

test('posts asset reactions with an explicit download action', async () => {
  const requests = [];

  await postAssetReaction({
    asset: {
      resolution: '1280x720',
      source: 'https://cdn.example.test/media/art.jpg',
      type: 'image',
    },
    config: {
      apiKey: 'local-key',
      domain: 'https://atlas.test',
    },
    downloadAction: 'skip',
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
    referrerUrl: 'https://www.example.test/post/123',
    source: 'example.test',
  });

  assert.equal(JSON.parse(requests[0].options.body).download_action, 'skip');
});

test('posts batch asset reactions to the extension endpoint', async () => {
  const requests = [];
  const response = await postAssetReactionBatch({
    config: {
      apiKey: 'local-key',
      domain: 'https://atlas.test',
    },
    fetchImpl: async (url, options) => {
      requests.push({ options, url });

      return {
        ok: true,
        async json() {
          return {
            items: [
              {
                asset_url: 'https://cdn.example.test/media/art-1.jpg',
                reaction: { type: 'love' },
              },
              {
                asset_url: 'https://cdn.example.test/media/art-2.jpg',
                reaction: { type: 'love' },
              },
            ],
          };
        },
      };
    },
    items: [
      {
        asset: {
          resolution: '1000x1400',
          source: 'https://cdn.example.test/media/art-1.jpg',
          type: 'image',
        },
        referrerUrl: 'https://www.example.test/post/123?file=1',
        source: 'example.test',
      },
      {
        asset: {
          resolution: '1200x1600',
          source: 'https://cdn.example.test/media/art-2.jpg',
          type: 'image',
        },
        referrerUrl: 'https://www.example.test/post/123?file=2',
        source: 'example.test',
      },
    ],
    reactionType: 'love',
  });

  assert.equal(response.items.length, 2);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://atlas.test/api/extension/reactions/batch');
  assert.equal(requests[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    items: [
      {
        asset_url: 'https://cdn.example.test/media/art-1.jpg',
        metadata: {
          asset_type: 'image',
          resolution: '1000x1400',
        },
        referrer_url: 'https://www.example.test/post/123?file=1',
        source: 'example.test',
      },
      {
        asset_url: 'https://cdn.example.test/media/art-2.jpg',
        metadata: {
          asset_type: 'image',
          resolution: '1200x1600',
        },
        referrer_url: 'https://www.example.test/post/123?file=2',
        source: 'example.test',
      },
    ],
    type: 'love',
  });
});

test('posts batch asset reactions with an explicit download action', async () => {
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
          source: 'https://cdn.example.test/media/art-1.jpg',
          type: 'image',
        },
        referrerUrl: 'https://www.example.test/post/123?file=1',
        source: 'example.test',
      },
    ],
    reactionType: 'love',
  });

  assert.equal(JSON.parse(requests[0].options.body).download_action, 'force');
});

test('checks existing Atlas state once by asset url', async () => {
  const requests = [];
  const response = await fetchAssetStatuses({
    assetUrls: [
      'https://cdn.example.test/media/art.jpg',
      'https://video.example.test/media/movie.mp4',
    ],
    config: {
      apiKey: 'local-key',
      domain: 'https://atlas.test',
    },
    fetchImpl: async (url, options) => {
      requests.push({ options, url });

      return {
        ok: true,
        async json() {
          return {
            assets: {
              'https://cdn.example.test/media/art.jpg': {
                reaction: { type: 'love' },
              },
            },
          };
        },
      };
    },
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://atlas.test/api/extension/assets/status');
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    asset_urls: [
      'https://cdn.example.test/media/art.jpg',
      'https://video.example.test/media/movie.mp4',
    ],
  });
  assert.equal(response.assets['https://cdn.example.test/media/art.jpg'].reaction.type, 'love');
});

test('checks existing Atlas state by asset and referrer urls', async () => {
  const requests = [];
  const response = await fetchAssetStatuses({
    assetUrls: [
      'https://cdn.example.test/media/art.jpg',
      'https://cdn.example.test/media/art.jpg',
    ],
    config: {
      apiKey: 'local-key',
      domain: 'https://atlas.test',
    },
    fetchImpl: async (url, options) => {
      requests.push({ options, url });

      return {
        ok: true,
        async json() {
          return {
            assets: {},
            referrers: {
              'https://www.example.test/post/123': {
                reaction: { type: 'love' },
              },
            },
          };
        },
      };
    },
    referrerUrls: [
      'https://www.example.test/post/123',
      'https://www.example.test/post/123',
    ],
  });

  assert.equal(requests.length, 1);
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    asset_urls: ['https://cdn.example.test/media/art.jpg'],
    referrer_urls: ['https://www.example.test/post/123'],
  });
  assert.equal(response.referrers['https://www.example.test/post/123'].reaction.type, 'love');
});

test('skips status checks when no asset or referrer urls are present', async () => {
  const response = await fetchAssetStatuses({
    assetUrls: [],
    config: {
      apiKey: 'local-key',
      domain: 'https://atlas.test',
    },
    fetchImpl: async () => {
      throw new Error('fetch should not be called');
    },
    referrerUrls: [],
  });

  assert.deepEqual(response, { assets: {}, referrers: {} });
});

test('deletes downloaded Atlas files through the extension endpoint', async () => {
  const requests = [];
  const response = await deleteAtlasFile({
    config: {
      apiKey: 'local-key',
      domain: 'https://atlas.test',
    },
    fetchImpl: async (url, options) => {
      requests.push({ options, url });

      return {
        ok: true,
        async json() {
          return {
            deleted: true,
            file_id: 123,
          };
        },
      };
    },
    fileId: 123,
  });

  assert.equal(response.deleted, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://atlas.test/api/extension/files/123');
  assert.equal(requests[0].options.method, 'DELETE');
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    also_delete_record: true,
    also_from_disk: true,
  });
});
