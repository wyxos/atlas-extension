import assert from 'node:assert/strict';
import test from 'node:test';
import { captureProviderIdentity } from '../src/content/provider-identities.js';
import { decorateAssetWithMatchIdentity, statusMatchItemForAsset } from '../src/content/asset-match-runtime.js';
import { postAssetReaction, postAssetReactionBatch, fetchAssetStatuses } from '../src/background/desktop-api.js';
import { createContentInterestRegistry } from '../src/background/content-interest-registry.js';
import { createBrowserResolutionCache } from '../src/shared/browser-resolution-cache.js';

const id = 'B7C73535-DDEA-08F9-A423-69BB9C4D44AE';
const pageUrl = 'https://www.deviantart.com/fixture/art/Example-1377966303';
const documentContext = { querySelector: () => ({ getAttribute: () => `DeviantArt://deviation/${id}` }) };
const identity = { provider: 'deviantart', item_id: id.toLowerCase() };

test('provider event routing normalizes DA pages while preserving artwork boundaries', async () => {
  const responses = new Map([[pageUrl, 'deviantart:1377966303'], [pageUrl + '?file=2&utm_source=test', 'deviantart:1377966303']]);
  const cache = createBrowserResolutionCache({ resolve: async ({pages}) => ({pages: pages.map(({url}) => ({url, canonicalPage: responses.get(url) ?? url}))}) });
  await cache.prepare([...responses.keys()]);
  const registry = createContentInterestRegistry({ storageArea: null, canonicalProviderPage: cache.canonical });
  await registry.ready;
  registry.register({ tabId: 1, documentId: 'da', sequence: 1, sourceUrls: [], referrerUrls: [`${pageUrl}?file=2&utm_source=test`] });
  registry.register({ tabId: 2, documentId: 'other', sequence: 1, sourceUrls: [], referrerUrls: [pageUrl.replace('1377966303', '1377966304')] });
  assert.deepEqual(registry.matchingTabIds({ referrerUrl: pageUrl, assetUrl: 'https://cdn.test/original.png' }), [1]);

  assert.notEqual(cache.canonical(pageUrl), cache.canonical(pageUrl.replace('deviantart.com', 'deviantart.com.evil.test')));
});

test('identity hints require a resolved Desktop page context', () => {
  assert.equal(captureProviderIdentity({ documentContext, pageUrl }), null);
  assert.deepEqual(captureProviderIdentity({ pageUrl, pageContext: {identity} }), identity);
});

test('identity hints survive single, batch and status transport without changing selected assets', async () => {
  const asset = decorateAssetWithMatchIdentity({ asset: { source: 'https://cdn.test/primary.png', type: 'image' }, pageUrl, siteDomain: 'deviantart.com', documentContext, pageContext: {identity} });
  assert.deepEqual(asset.providerIdentity, identity);
  let body;
  await postAssetReaction({ asset, referrerUrl: pageUrl, reactionType: 'like', transport: { reaction: (_, value) => { body = value; } } });
  assert.deepEqual(body.provider_identity, identity);
  assert.equal(body.asset_url, asset.source);
  const items = [1, 2].map(i => ({ asset: { ...asset, source: `https://cdn.test/${i}.png` }, referrerUrl: `${pageUrl}?file=${i}` }));
  await postAssetReactionBatch({ items, reactionType: 'like', transport: { reactionBatch: (_, value) => { body = value; } } });
  assert.deepEqual(body.items.map(i => i.provider_identity), [identity, identity]);
  assert.notEqual(body.items[0].asset_url, body.items[1].asset_url);
  assert.notEqual(body.items[0].referrer_url, body.items[1].referrer_url);
  await fetchAssetStatuses({ matchItems: [statusMatchItemForAsset(asset, 'asset')], transport: { assetStatuses: (_, value) => { body = value; } } });
  assert.deepEqual(body.match_items[0].provider_identity, identity);
  assert.equal(body.match_items[0].asset_url, asset.source);
  assert.equal(body.match_items[0].referrer_url, pageUrl);
});
