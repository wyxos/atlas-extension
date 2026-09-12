import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveAssetMatchIdentity, deriveReferrerMatchIdentity } from '../src/shared/asset-match-identity.js';
import { normalizeAssetSourcePreferences } from '../src/shared/asset-source-preferences.js';
import { decorateReferrerWithMatchIdentity } from '../src/content/asset-match-runtime.js';
import { postAssetReaction, postAssetReactionBatch } from '../src/background/desktop-api.js';
import { createReferrerBadgeManager } from '../src/content/referrer-badges.js';

const page = 'https://www.deviantart.com/artist/art/deviation-B-200';
const cleanup = { removeFragment: true, query: { mode: 'strip-selected', params: ['file'] } };
const preferences = { profiles: [{ domain: 'deviantart.com', referrerCleanup: cleanup,
  asset: { matching: { matchBy: 'source', cleanup: { query: { mode: 'none', params: [] }, removeFragment: false } } },
}] };

test('anchor matching uses the destination domain and remains independent of every widget rule', () => {
  const expected = deriveReferrerMatchIdentity({ referrerUrl: page, preferences });
  for (const matchBy of ['source', 'referrer']) {
    for (const mode of ['none', 'strip-all', 'keep-selected', 'strip-selected']) {
      const configured = globalThis.structuredClone(preferences);
      configured.profiles[0].asset.matching = { matchBy, ruleId: 'widget', cleanup: { removeFragment: true, query: { mode, params: ['token'] } } };
      const badge = decorateReferrerWithMatchIdentity({ preferences: configured,
        asset: { source: 'https://cdn.test/thumbnail?token=changing', referrerUrl: `${page}?file=1#preview` },
      });
      assert.deepEqual(badge.matchIdentity, expected);
      assert.equal(badge.providerIdentity, undefined);
      assert.equal(badge.providerReferrerUrl, undefined);
      const widget = deriveAssetMatchIdentity({ asset: { source: 'https://cdn.test/full?token=changing' },
        pageUrl: `${page}?file=1`, preferences: configured, siteDomain: 'deviantart.com' });
      const withoutAnchorRule = globalThis.structuredClone(configured);
      delete withoutAnchorRule.profiles[0].referrerCleanup;
      assert.deepEqual(widget, deriveAssetMatchIdentity({ asset: { source: 'https://cdn.test/full?token=changing' },
        pageUrl: `${page}?file=1`, preferences: withoutAnchorRule, siteDomain: 'deviantart.com' }));
    }
  }
  assert.notEqual(deriveReferrerMatchIdentity({ referrerUrl: page.replace('200', '201'), preferences }).match_url, expected.match_url);
});

test('old profiles preserve widget settings and default anchor URLs to exact matching', () => {
  const old = { profiles: [{ domain: 'deviantart.com', asset: { matching: { matchBy: 'referrer', cleanup } } }] };
  const normalized = normalizeAssetSourcePreferences(old);
  assert.deepEqual(normalized.profiles[0].asset.matching.cleanup, cleanup);
  assert.equal(deriveReferrerMatchIdentity({ referrerUrl: `${page}?file=1`, preferences: old }).match_url, `${page}?file=1`);
  const widget = deriveAssetMatchIdentity({ pageUrl: page, preferences: old, siteDomain: 'deviantart.com' }).matchIdentity;
  assert.notEqual(widget.rule_digest, deriveReferrerMatchIdentity({ referrerUrl: page, preferences }).rule_digest);
});

test('single and batch reactions save independent anchor identities while preserving item URLs', () => {
  const bodies = [];
  const widgetIdentity = { match_by: 'source', match_url: 'https://cdn.test/1', rule_digest: 'widget' };
  const asset = { source: 'https://cdn.test/1', matchIdentity: widgetIdentity };
  postAssetReaction({ asset, referrerUrl: `${page}?file=1`, preferences, reactionType: 'like',
    transport: { reaction: (_, body) => bodies.push(body) } });
  postAssetReactionBatch({ preferences, reactionType: 'like', items: [1, 2].map(index => ({
    asset: { source: `https://cdn.test/${index}` }, referrerUrl: `${page}?file=${index}`,
  })), transport: { reactionBatch: (_, body) => bodies.push(...body.items) } });
  assert.deepEqual(bodies[0].match_identity, widgetIdentity);
  assert.deepEqual(bodies.map(body => body.referrer_url), [`${page}?file=1`, `${page}?file=1`, `${page}?file=2`]);
  for (const body of bodies) assert.deepEqual(body.referrer_match_identity, deriveReferrerMatchIdentity({ referrerUrl: page, preferences }));
});

test('download events update cleaned destination badges without using thumbnail source matches', () => {
  const anchor = { href: page, tagName: 'A' };
  const element = { closest: () => anchor, currentSrc: 'https://cdn.test/shared-thumbnail', tagName: 'IMG',
    isConnected: true, naturalWidth: 320, naturalHeight: 240, src: '', style: { opacity: '' } };
  const manager = createReferrerBadgeManager({
    decorateAsset: asset => decorateReferrerWithMatchIdentity({ asset, preferences }),
    getOverlayController: () => ({ removeBadge() {}, upsertBadge() {} }),
    getVisibleRect: () => ({ left: 0, bottom: 240, width: 320 }), queueStatusCheck() {},
    removeDirectBadge() {}, removeOverlayBadge() {}, viewportPadding: 4,
  });
  manager.sync(element);
  manager.updateByDownloadEvent({ assetUrl: element.currentSrc, referrerUrl: page.replace('200', '201'), reaction: 'love' });
  assert.equal(manager.getAtlasStateByReferrerUrl(page)?.reaction, undefined);
  manager.updateByDownloadEvent({ referrerUrl: `${page}?file=1`, reaction: 'like' });
  assert.equal(manager.getAtlasStateByReferrerUrl(page).reaction, 'like');
});
