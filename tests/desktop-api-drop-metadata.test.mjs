import assert from 'node:assert/strict';
import test from 'node:test';

import { postAssetReaction } from '../src/background/desktop-api.js';

const preferences = { version: 3, domains: [], profiles: [] };

test('drop-zone page and element details are sent as additive reaction metadata', async () => {
  let sent;
  await postAssetReaction({
    asset: {
      altText: 'A cat', captureMethod: 'drop-zone', elementUrl: 'https://a.test/posts/7', filename: 'cat.png',
      linkText: '', pageTitle: 'Board', pageUrl: 'https://a.test/board', resolution: '640x480',
      source: 'https://cdn.a.test/cat.png', titleText: 'Cat', type: 'image',
    },
    credentials: {}, preferences, reactionType: 'like', referrerUrl: 'https://a.test/board', source: 'a.test',
    transport: { reaction: async (_, body) => { sent = body; return {}; } },
  });
  assert.deepEqual(sent.metadata, {
    alt_text: 'A cat', asset_type: 'image', capture_method: 'drop-zone', element_url: 'https://a.test/posts/7',
    filename: 'cat.png', height: 480, page_title: 'Board', page_url: 'https://a.test/board',
    resolution: '640x480', title_text: 'Cat', width: 640,
  });
});

test('ordinary badge reactions keep the existing metadata shape', async () => {
  let sent;
  await postAssetReaction({
    asset: { source: 'https://cdn.a.test/cat.png', type: 'image', resolution: '10x20' },
    credentials: {}, preferences, reactionType: 'like', referrerUrl: 'https://a.test/', source: 'a.test',
    transport: { reaction: async (_, body) => { sent = body; return {}; } },
  });
  assert.deepEqual(sent.metadata, { asset_type: 'image', resolution: '10x20', width: 10, height: 20 });
});

test('captured text metadata is trimmed and bounded', async () => {
  let sent;
  await postAssetReaction({
    asset: { source: 'https://cdn.a.test/x.png', type: 'image', altText: `  ${'x'.repeat(5000)}  `, pageTitle: '   ' },
    credentials: {}, preferences, reactionType: 'like', referrerUrl: 'https://a.test/', source: 'a.test',
    transport: { reaction: async (_, body) => { sent = body; return {}; } },
  });
  assert.equal(sent.metadata.alt_text.length, 1000);
  assert.equal('page_title' in sent.metadata, false);
});
