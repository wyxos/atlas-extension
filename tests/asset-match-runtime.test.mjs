import assert from 'node:assert/strict';
import test from 'node:test';

import { statusMatchItemForAsset } from '../src/content/asset-match-runtime.js';

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
