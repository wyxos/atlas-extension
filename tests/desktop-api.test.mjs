import assert from 'node:assert/strict';
import { deriveReferrerMatchIdentity } from '../src/shared/asset-match-identity.js';
import test from 'node:test';
import { createDesktopTransport } from '../src/background/desktop-transport.js';

import {
  createBatchReactionPoster,
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
    referrer_match_identity: deriveReferrerMatchIdentity({ referrerUrl: 'https://example.test/1' }),
    source: 'example.test',
  }]);
});

test('forwards explicit chunk idempotency keys to the mutation transport', async () => {
  const calls = [];
  for (const idempotencyKey of ['gallery:0', 'gallery:0', 'gallery:1']) {
    await postAssetReactionBatch({ credentials: {}, items: [], reactionType: 'like', idempotencyKey,
      transport: { reactionBatch: async (...args) => { calls.push(args); return {}; } } });
  }
  assert.deepEqual(calls.map((args) => args[2]), [
    { idempotencyKey: 'gallery:0' }, { idempotencyKey: 'gallery:0' }, { idempotencyKey: 'gallery:1' },
  ]);
});

test('a lost chunk response reuses its original prepared body and browser context', async () => {
  const post = createBatchReactionPoster();
  const calls = [];
  let preparations = 0;
  const runtimeContext = { cookies: [{ name: 'fixture', value: 'first' }], user_agent: 'Fixture' };
  const options = {
    credentials: { clientId: 'fixture-client' }, idempotencyKey: 'gallery:0', reactionType: 'like',
    downloadAction: 'force',
    items: [{ asset: { source: 'https://fixture.test/1.jpg', type: 'image' }, referrerUrl: 'https://fixture.test/post' }],
    prepareContext: async () => { preparations += 1; return { runtimeContext }; },
    transport: { reactionBatch: async (_credentials, body, requestOptions) => {
      calls.push({ body, requestOptions });
      if (calls.length === 1) throw Object.assign(new Error('Fixture lost response'), { retryable: true });
      return { items: [] };
    } },
  };
  await assert.rejects(post(options));
  runtimeContext.cookies[0].value = 'changed';
  await post(options);
  await post({ ...options, idempotencyKey: 'gallery:1' });
  assert.equal(preparations, 2);
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls[1].body.cookies[0].value, 'first');
  assert.equal(calls[1].body.download_action, 'force');
  assert.equal(calls[2].body.cookies[0].value, 'changed');
  assert.deepEqual(calls.map((call) => call.requestOptions.idempotencyKey), ['gallery:0', 'gallery:0', 'gallery:1']);
});

test('a Desktop-accepted chunk also retains its exact body if the content reply was lost', async () => {
  const post = createBatchReactionPoster();
  let preparations = 0;
  const bodies = [];
  const options = { credentials: { clientId: 'fixture-client' }, idempotencyKey: 'gallery:0', items: [], reactionType: 'like',
    prepareContext: async () => ({ runtimeContext: { user_agent: `Fixture ${++preparations}` } }),
    transport: { reactionBatch: async (_credentials, body) => { bodies.push(body); return { items: [] }; } } };
  await post(options);
  await post(options);
  assert.equal(preparations, 1);
  assert.deepEqual(bodies[0], bodies[1]);
  await assert.rejects(post({ ...options, reactionType: 'love' }), (error) => error.code === 'IDEMPOTENCY_CONFLICT');
  assert.equal(bodies.length, 2);
});

test('prepared chunk retention is bounded and scoped to the paired client', async () => {
  const post = createBatchReactionPoster({ maxPreparedRequests: 2 });
  let preparations = 0;
  const options = { credentials: { clientId: 'fixture-one' }, items: [], reactionType: 'like',
    prepareContext: async () => { preparations += 1; return {}; }, transport: { reactionBatch: async () => ({}) } };
  await post({ ...options, idempotencyKey: 'gallery:0' });
  await post({ ...options, idempotencyKey: 'gallery:0', credentials: { clientId: 'fixture-two' } });
  post.acknowledge({ idempotencyKey: 'gallery:0' });
  await post({ ...options, idempotencyKey: 'gallery:1' });
  await post({ ...options, idempotencyKey: 'gallery:0' });
  assert.equal(preparations, 4);
});

test('unacknowledged content replies remain pinned when the cache reaches capacity', async () => {
  const post = createBatchReactionPoster({ maxPreparedRequests: 2 });
  let preparations = 0;
  const options = { credentials: { clientId: 'fixture' }, items: [], reactionType: 'like',
    prepareContext: async () => ({ runtimeContext: { user_agent: `Fixture ${++preparations}` } }),
    transport: { reactionBatch: async () => ({ items: [] }) } };
  await post({ ...options, idempotencyKey: 'first', tabId: 1 });
  await post({ ...options, idempotencyKey: 'second', tabId: 2 });
  await assert.rejects(post({ ...options, idempotencyKey: 'third', tabId: 3 }), (error) =>
    error.code === 'GALLERY_REQUEST_PENDING' && error.retryable === true);
  await post({ ...options, idempotencyKey: 'first', tabId: 1 });
  assert.equal(preparations, 2);
  post.acknowledge({ tabId: 1, idempotencyKey: 'first' });
  await post({ ...options, idempotencyKey: 'third', tabId: 3 });
  assert.equal(preparations, 3);
});

test('the next segment can carry a lost acknowledgement without releasing other tabs', async () => {
  const post = createBatchReactionPoster();
  const options = { credentials: { clientId: 'fixture' }, items: [], reactionType: 'like',
    prepareContext: async () => ({}), transport: { reactionBatch: async () => ({ items: [] }) } };
  await post({ ...options, idempotencyKey: 'gallery:0', tabId: 1 });
  await post({ ...options, idempotencyKey: 'gallery:0', tabId: 2 });
  await assert.rejects(post({ ...options, idempotencyKey: 'gallery:1', tabId: 1 }), (error) => error.code === 'GALLERY_REQUEST_PENDING');
  await post({ ...options, idempotencyKey: 'gallery:1', acknowledgedIdempotencyKey: 'gallery:0', tabId: 1 });
  await assert.rejects(post({ ...options, idempotencyKey: 'gallery:1', tabId: 2 }), (error) => error.code === 'GALLERY_REQUEST_PENDING');
  post.removeTab(2);
  await post({ ...options, idempotencyKey: 'gallery:1', tabId: 2 });
});

test('inspecting a gallery cannot retain pending work or block its real action', async () => {
  const post = createBatchReactionPoster({ maxPreparedRequests: 1 });
  let preparations = 0;
  const calls = [];
  const options = { credentials: { clientId: 'fixture' }, tabId: 4, items: [], reactionType: 'like',
    prepareContext: async () => ({ runtimeContext: { user_agent: `Fixture ${++preparations}` } }),
    transport: { reactionBatch: async (_credentials, body) => { calls.push(body); return { items: [] }; } } };
  await post({ ...options, idempotencyKey: 'inspect:0', previewOnly: true });
  await post({ ...options, idempotencyKey: 'inspect:1', previewOnly: true });
  await post({ ...options, idempotencyKey: 'real:0' });
  await post({ ...options, idempotencyKey: 'inspect:2', previewOnly: true });
  await post({ ...options, idempotencyKey: 'real:0' });
  assert.equal(preparations, 4);
  assert.deepEqual(calls[2], calls[4]);
});

test('retired pairing and channel requests cannot block the newly selected identity', async () => {
  const post = createBatchReactionPoster({ maxPreparedRequests: 1 });
  let preparations = 0;
  const options = { credentials: { clientId: 'old-fixture' }, tabId: 4, items: [], reactionType: 'like',
    prepareContext: async () => { preparations += 1; return {}; },
    transport: { baseUrl: 'https://first.fixture.test', reactionBatch: async () => ({}) } };
  await post({ ...options, idempotencyKey: 'first:0' });
  await post({ ...options, credentials: { clientId: 'new-fixture' }, idempotencyKey: 'new:0' });
  await post({ ...options, credentials: { clientId: 'new-fixture' }, idempotencyKey: 'second:0',
    transport: { ...options.transport, baseUrl: 'https://second.fixture.test' } });
  assert.equal(preparations, 3);
});

test('force retries preserve the HTTP identity and replay a cached acceptance without another download intent', async () => {
  const savedResponses = new Map();
  const requests = [];
  let intents = 0;
  const transport = createDesktopTransport({ channel: 'dev', fetchImpl: async (_url, request) => {
    const key = request.headers['Idempotency-Key'];
    requests.push({ key, body: request.body });
    let saved = savedResponses.get(key);
    if (!saved) {
      saved = { body: request.body, payload: { items: [{ asset_url: 'https://fixture.test/image.jpg', download: { requested: true, status: 'queued' } }] } };
      savedResponses.set(key, saved);
      intents += 1;
      if (intents === 1) throw new Error('Fixture response lost after acceptance');
    }
    assert.equal(request.body, saved.body);
    return new globalThis.Response(JSON.stringify({ ok: true, data: saved.payload }), { status: 202 });
  } });
  const post = createBatchReactionPoster();
  const options = { credentials: { clientId: 'fixture', clientToken: 'synthetic', channel: 'dev' }, tabId: 5,
    idempotencyKey: 'force-gallery:0', downloadAction: 'force', reactionType: 'like',
    items: [{ asset: { source: 'https://fixture.test/image.jpg', type: 'image' }, referrerUrl: 'https://fixture.test/post' }],
    prepareContext: async () => ({}), transport };
  await assert.rejects(post(options), (error) => error.code === 'DESKTOP_OFFLINE');
  const accepted = await post(options);
  assert.equal(accepted.items[0].download.requested, true);
  assert.equal(intents, 1);
  assert.deepEqual(requests[0], requests[1]);
  await post({ ...options, idempotencyKey: 'force-gallery:1', acknowledgedIdempotencyKey: 'force-gallery:0' });
  assert.equal(intents, 2);
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
