import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deleteAtlasFileViaBackground,
  fetchAssetStatusesViaBackground,
  fetchOpenReferrerCountsViaBackground,
  openReferrerInTabViaBackground,
  postAssetReactionBatchViaBackground,
  postAssetReactionViaBackground,
  sendBackgroundRequest,
} from '../src/content/background-api.js';

test('requests asset statuses through the background worker', async () => {
  const messages = [];
  const payload = await fetchAssetStatusesViaBackground({
    assetUrls: ['https://cdn.example.test/art.jpg'],
    referrerUrls: ['https://www.example.test/post/123'],
    runtime: {
      sendMessage(message, callback) {
        messages.push(message);
        callback({
          ok: true,
          payload: {
            assets: {
              'https://cdn.example.test/art.jpg': {
                reaction: { type: 'like' },
              },
            },
          },
        });
      },
    },
  });

  assert.deepEqual(messages, [{
    assetUrls: ['https://cdn.example.test/art.jpg'],
    referrerUrls: ['https://www.example.test/post/123'],
    type: 'atlas-extension.asset-statuses',
  }]);
  assert.equal(payload.assets['https://cdn.example.test/art.jpg'].reaction.type, 'like');
});

test('posts asset reactions through the background worker', async () => {
  const messages = [];
  const payload = await postAssetReactionViaBackground({
    asset: {
      source: 'https://cdn.example.test/video.mp4',
      type: 'video',
    },
    downloadAction: 'skip',
    reactionType: 'love',
    referrerUrl: 'https://www.example.test/post/123',
    runtime: {
      sendMessage(message, callback) {
        messages.push(message);
        callback({
          ok: true,
          payload: {
            reaction: { type: 'love' },
          },
        });
      },
    },
    source: 'example.test',
  });

  assert.deepEqual(messages, [{
    asset: {
      source: 'https://cdn.example.test/video.mp4',
      type: 'video',
    },
    downloadAction: 'skip',
    reactionType: 'love',
    referrerUrl: 'https://www.example.test/post/123',
    source: 'example.test',
    type: 'atlas-extension.asset-reaction',
  }]);
  assert.equal(payload.reaction.type, 'love');
});

test('posts batch asset reactions through the background worker', async () => {
  const messages = [];
  const payload = await postAssetReactionBatchViaBackground({
    items: [
      {
        asset: {
          source: 'https://cdn.example.test/file-1.jpg',
          type: 'image',
        },
        referrerUrl: 'https://www.example.test/post/123?file=1',
        source: 'example.test',
      },
      {
        asset: {
          source: 'https://cdn.example.test/file-2.jpg',
          type: 'image',
        },
        referrerUrl: 'https://www.example.test/post/123?file=2',
        source: 'example.test',
      },
    ],
    downloadAction: 'force',
    reactionType: 'love',
    runtime: {
      sendMessage(message, callback) {
        messages.push(message);
        callback({
          ok: true,
          payload: {
            items: [
              { reaction: { type: 'love' } },
              { reaction: { type: 'love' } },
            ],
          },
        });
      },
    },
  });

  assert.deepEqual(messages, [{
    items: [
      {
        asset: {
          source: 'https://cdn.example.test/file-1.jpg',
          type: 'image',
        },
        referrerUrl: 'https://www.example.test/post/123?file=1',
        source: 'example.test',
      },
      {
        asset: {
          source: 'https://cdn.example.test/file-2.jpg',
          type: 'image',
        },
        referrerUrl: 'https://www.example.test/post/123?file=2',
        source: 'example.test',
      },
    ],
    downloadAction: 'force',
    reactionType: 'love',
    type: 'atlas-extension.asset-reaction-batch',
  }]);
  assert.equal(payload.items.length, 2);
});

test('deletes Atlas files through the background worker', async () => {
  const messages = [];
  const payload = await deleteAtlasFileViaBackground({
    fileId: 123,
    runtime: {
      sendMessage(message, callback) {
        messages.push(message);
        callback({
          ok: true,
          payload: {
            deleted: true,
            file_id: 123,
          },
        });
      },
    },
  });

  assert.deepEqual(messages, [{
    fileId: 123,
    type: 'atlas-extension.file-delete',
  }]);
  assert.equal(payload.deleted, true);
});

test('requests open referrer counts through the background worker', async () => {
  const messages = [];
  const payload = await fetchOpenReferrerCountsViaBackground({
    referrerUrls: ['https://www.example.test/post/123'],
    runtime: {
      sendMessage(message, callback) {
        messages.push(message);
        callback({
          ok: true,
          payload: {
            counts: {
              'https://www.example.test/post/123': 1,
            },
          },
        });
      },
    },
  });

  assert.deepEqual(messages, [{
    referrerUrls: ['https://www.example.test/post/123'],
    type: 'atlas-extension.open-referrer-counts',
  }]);
  assert.equal(payload.counts['https://www.example.test/post/123'], 1);
});

test('opens confirmed referrers through the background worker', async () => {
  const messages = [];
  const payload = await openReferrerInTabViaBackground({
    runtime: {
      sendMessage(message, callback) {
        messages.push(message);
        callback({
          ok: true,
          payload: {
            opened: true,
          },
        });
      },
    },
    url: 'https://www.example.test/post/123',
  });

  assert.deepEqual(messages, [{
    type: 'atlas-extension.open-referrer-url',
    url: 'https://www.example.test/post/123',
  }]);
  assert.equal(payload.opened, true);
});

test('rejects failed background responses', async () => {
  await assert.rejects(
    () => sendBackgroundRequest({
      type: 'atlas-extension.asset-statuses',
    }, {
      runtime: {
        sendMessage(_message, callback) {
          callback({
            error: 'Atlas rejected the request.',
            ok: false,
          });
        },
      },
    }),
    /Atlas rejected the request/,
  );
});

test('times out missing background responses', async () => {
  await assert.rejects(
    () => sendBackgroundRequest({
      type: 'atlas-extension.asset-statuses',
    }, {
      runtime: {
        sendMessage() {},
      },
      timeoutMs: 1,
    }),
    /timed out/,
  );
});
