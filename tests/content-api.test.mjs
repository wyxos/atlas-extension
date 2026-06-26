import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deleteAtlasFile,
  fetchAssetStatuses,
  loadAtlasContentConfig,
  postAssetReaction,
} from '../src/content/atlas-api.js';

test('loads content config from storage or local defaults', async () => {
  assert.deepEqual(await loadAtlasContentConfig({
    async get() {
      return {};
    },
  }), {
    apiKey: 'atlas_local_development_key',
    domain: 'https://atlas.test',
  });

  assert.deepEqual(await loadAtlasContentConfig({
    get(key, callback) {
      callback({
        [key]: {
          apiKey: 'stored-key',
          domain: 'https://stored.example.test',
        },
      });
    },
  }), {
    apiKey: 'stored-key',
    domain: 'https://stored.example.test',
  });

  assert.deepEqual(await loadAtlasContentConfig({
    get() {},
  }, {
    storageTimeoutMs: 1,
  }), {
    apiKey: 'atlas_local_development_key',
    domain: 'https://atlas.test',
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
