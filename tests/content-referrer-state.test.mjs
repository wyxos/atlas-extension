import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hasAtlasReferrerState,
  normalizeComparableReferrerUrl,
  resolveReferrerBadgeState,
} from '../src/content/referrer-state.js';

test('normalizes only comparable non-root HTTP URLs for tab state', () => {
  assert.equal(normalizeComparableReferrerUrl('https://example.test/post#one'), 'https://example.test/post#one');
  assert.equal(normalizeComparableReferrerUrl('https://example.test/'), null);
  assert.equal(normalizeComparableReferrerUrl('mailto:test@example.test'), null);
});

test('detects Atlas referrer reaction and blacklist states', () => {
  assert.equal(hasAtlasReferrerState({ reaction: { type: 'love' } }), true);
  assert.equal(hasAtlasReferrerState({ blacklisted_at: '2026-06-26T10:00:00Z' }), true);
  assert.equal(hasAtlasReferrerState({ reaction: null }), false);
});

test('prioritizes Atlas reaction over current-page and open-tab indicators', () => {
  assert.deepEqual(
    resolveReferrerBadgeState({
      atlasState: { reaction: { type: 'love' } },
      currentPageUrl: 'https://example.test/post#one',
      openCounts: { 'https://example.test/post#one': 2 },
      referrerUrl: 'https://example.test/post#one',
    }),
    { reaction: { type: 'love' } },
  );
});

test('uses a current-page indicator before opened-elsewhere state', () => {
  assert.deepEqual(
    resolveReferrerBadgeState({
      atlasState: {},
      currentPageUrl: 'https://example.test/post#one',
      openCounts: { 'https://example.test/post#one': 2 },
      referrerUrl: 'https://example.test/post#one',
    }),
    { referrerStatus: 'current-page' },
  );
});

test('uses opened-elsewhere state only when no reaction or current-page match exists', () => {
  assert.deepEqual(
    resolveReferrerBadgeState({
      atlasState: {},
      currentPageUrl: 'https://example.test/feed',
      openCounts: { 'https://example.test/post#one': 1 },
      referrerUrl: 'https://example.test/post#one',
    }),
    { referrerStatus: 'opened-elsewhere' },
  );

  assert.equal(
    resolveReferrerBadgeState({
      atlasState: {},
      currentPageUrl: 'https://example.test/feed',
      openCounts: {},
      referrerUrl: 'https://example.test/post#one',
    }),
    null,
  );
});
