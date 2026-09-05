import assert from 'node:assert/strict';
import test from 'node:test';
import { submitWithProviderFallback, matchesReactionFile } from '../src/content/provider-reaction.js';
import { canonicalCivitaiPage } from '../src/shared/civitai-page.js';
import { createContentInterestRegistry } from '../src/background/content-interest-registry.js';
import { postAssetReaction, fetchAssetStatuses } from '../src/background/desktop-api.js';
import { decorateAssetWithMatchIdentity, statusMatchItemForAsset } from '../src/content/asset-match-runtime.js';

const providerError = Object.assign(new Error('Unavailable'), { code: 'PROVIDER_RESOLUTION_FAILED' });

test('provider failure requires explicit fallback and preserves normal errors', async () => {
  const calls = [];
  const result = await submitWithProviderFallback({
    submit: async (fallback) => { calls.push(fallback); if (!fallback) throw providerError; return { saved: true }; },
    confirmFallback: async () => 'browser-download',
  });
  assert.deepEqual(calls, [false, true]);
  assert.equal(result.saved, true);
  const canceled = await submitWithProviderFallback({ submit: async () => { throw providerError; }, confirmFallback: async () => 'cancel' });
  assert.equal(canceled, null);
  await assert.rejects(submitWithProviderFallback({ submit: async () => { throw new Error('offline'); }, confirmFallback: async () => assert.fail('not a provider error') }), /offline/);
});

test('navigation during fallback cannot react to a different page', async () => {
  let current = true;
  let calls = 0;
  assert.equal(await submitWithProviderFallback({
    submit: async () => { calls += 1; throw providerError; },
    confirmFallback: async () => { current = false; return 'browser-download'; },
    isCurrent: () => current,
  }), null);
  assert.equal(calls, 1);
});

test('canonical download events update a browser variant only after file identity is known', () => {
  const asset = { source: 'https://cdn.test/browser.webm' };
  assert.equal(matchesReactionFile('https://cdn.test/api.mp4', asset, { file: { id: 42 } }, { file: { id: 42 } }), true);
  assert.equal(matchesReactionFile('https://cdn.test/api.mp4', asset, { file: { id: 41 } }, { file: { id: 42 } }), false);
  assert.equal(matchesReactionFile('https://cdn.test/api.mp4', asset, {}, {}), false);
});

test('CivitAI events reach matching red and com page interests without cross-site matches', async () => {
  const registry = createContentInterestRegistry({ storageArea: null });
  await registry.ready;
  registry.register({ tabId: 1, documentId: 'red', sequence: 1, sourceUrls: [], referrerUrls: ['https://civitai.red/images/42?view=1'] });
  registry.register({ tabId: 2, documentId: 'other', sequence: 1, sourceUrls: [], referrerUrls: ['https://civitai.com.evil.test/images/42'] });
  assert.deepEqual(registry.matchingTabIds({ referrerUrl: 'https://civitai.com/images/42', assetUrl: 'https://cdn.test/api.mp4' }), [1]);
  assert.equal(canonicalCivitaiPage('https://www.civitai.red/images/42/'), 'https://civitai.com/images/42');
  assert.equal(canonicalCivitaiPage('https://civitai.red/posts/42'), 'https://civitai.red/posts/42');
});

test('only an explicit browser fallback opts out of Desktop provider lookup', async () => {
  for (const useBrowserDownload of [undefined, false, true]) {
    let body;
    await postAssetReaction({ asset: { source: 'https://cdn.test/media.mp4', type: 'video' }, reactionType: 'like', useBrowserDownload,
      transport: { reaction: async (_, payload) => { body = payload; } } });
    assert.equal(body.use_browser_download, useBrowserDownload === true ? true : undefined);
  }
});

test('CivitAI media status carries the referrer and actual media URL through transport', async () => {
  for (const host of ['civitai.com', 'civitai.red']) {
    const pageUrl = `https://${host}/images/42?view=1`;
    const source = 'https://image.civitai.com/token/key/transcode=true/browser.webm';
    const asset = decorateAssetWithMatchIdentity({ asset: { source }, pageUrl, siteDomain: host });
    const item = statusMatchItemForAsset(asset, 'asset');
    let body;
    await fetchAssetStatuses({ matchItems: [item], transport: { assetStatuses: async (_, payload) => { body = payload; } } });
    assert.equal(body.match_items[0].referrer_url, pageUrl);
    assert.equal(body.match_items[0].asset_url, source);
    assert.equal(body.match_items[0].match_by, 'source');
    assert.equal(asset.matchIdentity.referrer_url, undefined);
  }
  const asset = decorateAssetWithMatchIdentity({
    asset: { source: 'https://cdn.test/image.jpg' },
    pageUrl: 'https://civitai.com.evil.test/images/42', siteDomain: 'civitai.com.evil.test',
  });
  assert.equal(statusMatchItemForAsset(asset, 'asset').referrer_url, undefined);
});
