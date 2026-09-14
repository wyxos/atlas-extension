import assert from 'node:assert/strict';
import test from 'node:test';
import { withReactionPageContext } from '../src/background/reaction-page-context.js';
import { postAssetReaction, postAssetReactionBatch } from '../src/background/desktop-api.js';
import { collectReactionRuntimeContext } from '../src/background/reaction-runtime-context.js';

const top = 'https://site.test/watch?id=42';
const frame = 'https://player.test/embed/42';
const message = {
  type: 'atlas-extension.asset-reaction', reactionType: 'like', referrerUrl: frame,
  asset: { type: 'video', source: frame, matchIdentity: { match_by: 'referrer', match_url: frame } },
};

test('nested frame reactions preserve media identity while forwarding the browser top page and its cookies', async () => {
  const enriched = withReactionPageContext(message, { frameId: 7, url: frame, tab: { url: top } });
  let body;
  await postAssetReaction({ ...enriched, transport: { reaction: (_, value) => { body = value; } } });
  assert.equal(body.metadata.top_page_url, top);
  assert.equal(body.referrer_url, frame);
  assert.equal(body.asset_url, frame);
  assert.deepEqual(body.match_identity, message.asset.matchIdentity);
  assert.equal(message.asset.topPageUrl, undefined);
  const urls = [];
  await collectReactionRuntimeContext(enriched, { chromeApi: { cookies: { getAll: ({ url }, done) => { urls.push(url); done([]); } } } });
  assert.deepEqual(urls, [frame, top]);
});

test('batch payloads keep top-page context only for videos', async () => {
  const enriched = withReactionPageContext({ type: 'atlas-extension.asset-reaction-batch', items: [
    { asset: message.asset, referrerUrl: frame },
    { asset: { type: 'image', source: 'https://cdn.test/a.jpg' }, referrerUrl: frame },
  ] }, { frameId: 3, tab: { url: top } });
  let body;
  await postAssetReactionBatch({ ...enriched, transport: { reactionBatch: (_, value) => { body = value; } } });
  assert.equal(body.items[0].metadata.top_page_url, top);
  assert.equal(body.items[1].metadata.top_page_url, undefined);
});

test('missing, restricted and top-level senders cannot supply a forged top page', () => {
  const forged = { ...message, asset: { ...message.asset, topPageUrl: 'https://forged.test/' } };
  for (const sender of [undefined, { frameId: 0, tab: { url: top } }, { frameId: 2 },
    ...['about:blank', 'blob:https://site.test/id', 'file:///local', 'https://user:pass@site.test/'].map((url) => ({ frameId: 2, tab: { url } })),
  ]) {
    assert.equal(withReactionPageContext(forged, sender).asset.topPageUrl, undefined);
  }
});
