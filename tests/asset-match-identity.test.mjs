import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveAssetMatchIdentity } from '../src/shared/asset-match-identity.js';

test('derives source match identity by default without cleaning raw urls', () => {
  const result = deriveAssetMatchIdentity({
    asset: {
      source: 'https://cdn.example.test/media/art.jpg?token=123#preview',
    },
    pageUrl: 'https://www.example.test/post/123',
    preferences: {
      domains: [],
      profiles: [],
      version: 3,
    },
    siteDomain: 'example.test',
  });

  assert.equal(result.rawSourceUrl, 'https://cdn.example.test/media/art.jpg?token=123#preview');
  assert.equal(result.rawReferrerUrl, 'https://www.example.test/post/123');
  assert.equal(result.matchIdentity.match_by, 'source');
  assert.equal(result.matchIdentity.match_url, 'https://cdn.example.test/media/art.jpg?token=123#preview');
});

test('derives cleaned referrer match identity from a profile rule', () => {
  const result = deriveAssetMatchIdentity({
    asset: {
      referrerUrl: 'https://www.facebook.com/photo/?fbid=122099716773370530&set=a.1#comments',
      source: 'https://scontent.example.test/v/t39/photo.jpg?oh=volatile-token',
    },
    pageUrl: 'https://www.facebook.com/photo/?fbid=122099716773370530&set=a.1',
    preferences: {
      domains: ['facebook.com'],
      profiles: [
        {
          asset: {
            matching: {
              cleanup: {
                query: {
                  mode: 'keep-selected',
                  params: ['fbid'],
                },
                removeFragment: true,
              },
              matchBy: 'referrer',
              ruleId: 'facebook-photo',
            },
          },
          domain: 'facebook.com',
          referrer: {
            rules: [],
          },
        },
      ],
      version: 3,
    },
    siteDomain: 'www.facebook.com',
  });

  assert.equal(result.rawSourceUrl, 'https://scontent.example.test/v/t39/photo.jpg?oh=volatile-token');
  assert.equal(result.rawReferrerUrl, 'https://www.facebook.com/photo/?fbid=122099716773370530&set=a.1#comments');
  assert.deepEqual(result.matchIdentity, {
    match_by: 'referrer',
    match_url: 'https://www.facebook.com/photo/?fbid=122099716773370530',
    rule_digest: result.matchIdentity.rule_digest,
    rule_id: 'facebook-photo',
  });
  assert.match(result.matchIdentity.rule_digest, /^[a-z0-9-]+$/);
});
