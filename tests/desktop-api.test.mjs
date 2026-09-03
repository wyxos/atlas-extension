import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fetchAssetStatuses,
  postAssetReaction,
  postAssetReactionBatch,
} from '../src/background/desktop-api.js';

test('preserves the reaction payload including browser cookies and user agent', async () => {
  let request;
  const payload = await postAssetReaction({
    asset: {
      matchIdentity: { lookup_id: 'lookup' },
      resolution: '1200x800',
      source: 'https://cdn.example.test/image.jpg',
      type: 'image',
    },
    credentials: {},
    downloadAction: 'download',
    reactionType: 'love',
    referrerUrl: 'https://example.test/post',
    runtimeContext: {
      cookies: [{ name: 'session', value: 'provider-cookie' }],
      user_agent: 'Browser UA',
    },
    source: 'example.test',
    transport: {
      reaction: async (_credentials, body) => { request = body; return { queued: true }; },
    },
  });

  assert.equal(payload.queued, true);
  assert.equal(request.cookies[0].value, 'provider-cookie');
  assert.equal(request.user_agent, 'Browser UA');
  assert.equal(request.asset_url, 'https://cdn.example.test/image.jpg');
  assert.equal(request.download_action, 'download');
  assert.deepEqual(request.metadata, {
    asset_type: 'image', resolution: '1200x800', width: 1200, height: 800,
  });
});

test('sends the complete YouTube watch URL to Desktop', async () => {
  let request;
  const watchUrl = 'https://www.youtube.com/watch?v=ariZ13hVPb4';

  await postAssetReaction({
    asset: {
      matchIdentity: {
        lookup_id: 'youtube-lookup',
        match_by: 'source',
        match_url: 'https://www.youtube.com/watch',
        rule_digest: 'cleanup-rule',
      },
      source: watchUrl,
      type: 'video',
    },
    credentials: {},
    downloadAction: 'download',
    reactionType: 'love',
    referrerUrl: watchUrl,
    source: 'youtube.com',
    transport: {
      reaction: async (_credentials, body) => { request = body; return { queued: true }; },
    },
  });

  assert.equal(request.asset_url, watchUrl);
  assert.equal(request.referrer_url, watchUrl);
  assert.equal(request.match_identity.match_url, 'https://www.youtube.com/watch');
});

test('preserves batch reaction item shapes', async () => {
  let request;
  await postAssetReactionBatch({
    credentials: {},
    items: [{
      asset: { source: 'https://cdn.example.test/1.jpg', type: 'image' },
      referrerUrl: 'https://example.test/1',
      source: 'example.test',
    }],
    reactionType: 'like',
    transport: {
      reactionBatch: async (_credentials, body) => { request = body; return {}; },
    },
  });

  assert.deepEqual(request.items, [{
    asset_url: 'https://cdn.example.test/1.jpg',
    metadata: { asset_type: 'image' },
    referrer_url: 'https://example.test/1',
    source: 'example.test',
  }]);
});

test('deduplicates status requests and keeps derived match identities', async () => {
  let request;
  await fetchAssetStatuses({
    assetUrls: ['https://cdn.example.test/1.jpg', 'https://cdn.example.test/1.jpg'],
    credentials: {},
    matchItems: [{
      lookup_id: 'lookup-1',
      match_by: 'source',
      match_url: 'https://cdn.example.test/1.jpg',
      rule_digest: 'digest',
    }],
    referrerUrls: [],
    transport: {
      assetStatuses: async (_credentials, body) => { request = body; return {}; },
    },
  });

  assert.deepEqual(request.asset_urls, ['https://cdn.example.test/1.jpg']);
  assert.equal(request.match_items[0].lookup_id, 'lookup-1');
});

test('sends DeviantArt batch original-size hints without calculating preview sizes', async () => {
  let request;
  await postAssetReactionBatch({
    credentials: {},
    items: [{
      asset: { source: 'https://cdn.example.test/portrait.jpg', type: 'image', resolution: '1200x1800' },
      referrerUrl: 'https://www.deviantart.com/artist/art/example?file=2',
      source: 'www.deviantart.com',
    }],
    reactionType: 'like',
    transport: { reactionBatch: async (_credentials, body) => { request = body; return {}; } },
  });
  assert.deepEqual(request.items[0].metadata, {
    asset_type: 'image', resolution: '1200x1800', width: 1200, height: 1800,
  });
});

test('omits numeric dimensions when resolution is absent, incomplete, or invalid', async () => {
  for (const resolution of [undefined, '', '1200x', '0x1800', '-1x1800', '1.5x1800', '4294967296x1800']) {
    let request;
    await postAssetReaction({
      asset: { source: 'https://cdn.example.test/image.jpg', type: 'image', resolution },
      credentials: {}, reactionType: 'like',
      transport: { reaction: async (_credentials, body) => { request = body; return {}; } },
    });
    assert.equal(Object.hasOwn(request.metadata, 'width'), false);
    assert.equal(Object.hasOwn(request.metadata, 'height'), false);
  }
});
