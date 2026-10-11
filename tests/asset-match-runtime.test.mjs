import assert from 'node:assert/strict';
import test from 'node:test';

import { decorateAssetWithMatchIdentity, statusMatchItemForAsset } from '../src/content/asset-match-runtime.js';

test('matched provider pages preserve status context when their item identity is absent', () => {
  const pageUrl = 'https://provider.example.test/artist/art/fixture-123';
  const source = 'https://media.example.test/fixture.jpg?token=fresh';
  const asset = decorateAssetWithMatchIdentity({
    asset: { source }, pageUrl, siteDomain: 'provider.example.test',
    pageContext: { url: pageUrl, provider: 'unrecognized-provider', identity: null },
  });
  const status = statusMatchItemForAsset(asset, 'asset');
  assert.equal(status.referrer_url, pageUrl);
  assert.equal(status.asset_url, source);
  assert.equal('provider_identity' in status, false);
});

test('generic pages do not acquire provider status context', () => {
  const asset = decorateAssetWithMatchIdentity({
    asset: { source: 'https://media.example.test/fixture.jpg' },
    pageUrl: 'https://generic.example.test/page', siteDomain: 'generic.example.test',
    pageContext: { provider: null, identity: null },
  });
  const status = statusMatchItemForAsset(asset, 'asset');
  assert.equal('referrer_url' in status, false);
});

test('uses a bounded lookup id for long asset source urls', () => {
  const longSourceUrl = [
    'https://scontent.example.test/v/t39.99422-6/photo.png?ccb=1-7',
    'cstp=mx671x1000',
    'oh=00_AQB0MKgb7aq4R0JDf6tiOjJJzU0Q1a-tAaCo8s8AIZWaBQ',
    'stp=dst-jpg_tt6',
    `token=${'x'.repeat(260)}`,
  ].join('&');

  const matchItem = statusMatchItemForAsset({
    matchIdentity: {
      match_by: 'referrer',
      match_url: 'https://www.facebook.com/photo/?fbid=1577573303728044',
      rule_digest: 'facebook-photo-v1',
      rule_id: 'facebook-photo',
    },
    source: longSourceUrl,
  }, 'asset');

  assert.equal(matchItem.match_url, 'https://www.facebook.com/photo/?fbid=1577573303728044');
  assert.equal(matchItem.match_by, 'referrer');
  assert.equal(matchItem.rule_digest, 'facebook-photo-v1');
  assert.equal(matchItem.rule_id, 'facebook-photo');
  assert.match(matchItem.lookup_id, /^asset:[a-z0-9]+$/);
  assert.ok(matchItem.lookup_id.length <= 255);
  assert.equal(matchItem.lookup_id.includes(longSourceUrl), false);
});
