import assert from 'node:assert/strict';
import test from 'node:test';

import { createReferrerBadgeManager } from '../src/content/referrer-badges.js';

test('renders and clears compact referrer badges from Atlas status', () => {
  const upserts = [];
  const removals = [];
  const queued = [];
  let overlayCreates = 0;
  const element = createLinkedImage();
  const manager = createReferrerBadgeManager({
    getOverlayController() {
      overlayCreates += 1;

      return {
        removeBadge: (id) => removals.push(id),
        upsertBadge: (id, badge) => upserts.push({ badge, id }),
      };
    },
    getVisibleRect: () => ({
      bottom: 200,
      left: 20,
      width: 80,
    }),
    queueStatusCheck: (referrerUrl) => queued.push(referrerUrl),
    removeDirectBadge: () => {},
    removeOverlayBadge: (id) => removals.push(id),
    viewportPadding: 4,
  });

  assert.equal(manager.sync(element), true);
  assert.deepEqual(queued, ['https://www.example.test/post/123']);
  assert.equal(overlayCreates, 0);
  assert.equal(element.style.opacity, '');

  manager.updateByReferrerUrl('https://www.example.test/post/123', {
    file: {
      id: 123,
    },
    reaction: {
      type: 'love',
    },
  });

  assert.equal(overlayCreates, 1);
  assert.equal(element.style.opacity, '0.3');
  assert.equal(upserts[0].badge.variant, 'referrer');
  assert.equal(upserts[0].badge.activeReaction, 'love');
  assert.equal(Object.hasOwn(upserts[0].badge, 'readOnly'), false);
  assert.equal(Object.hasOwn(upserts[0].badge, 'atlasFileUrl'), false);
  assert.equal(Object.hasOwn(upserts[0].badge, 'canDeleteFile'), false);
  assert.equal(Object.hasOwn(upserts[0].badge, 'progressLabel'), false);
  assert.equal(Object.hasOwn(upserts[0].badge, 'summary'), false);
  assert.equal(Object.hasOwn(upserts[0].badge, 'timestampLabel'), false);

  manager.replaceByReferrerUrl('https://www.example.test/post/123', {});

  assert.equal(element.style.opacity, '');
  assert.deepEqual(removals, ['referrer-asset-0']);
});

test('updates referrer badges from matching download events', () => {
  const upserts = [];
  const element = createLinkedImage();
  const manager = createReferrerBadgeManager({
    getOverlayController: () => ({
      removeBadge: () => {},
      upsertBadge: (id, badge) => upserts.push({ badge, id }),
    }),
    getVisibleRect: () => ({
      bottom: 200,
      left: 20,
      width: 320,
    }),
    queueStatusCheck: () => {},
    removeDirectBadge: () => {},
    removeOverlayBadge: () => {},
    viewportPadding: 4,
  });

  manager.sync(element);
  manager.updateByReferrerUrl('https://www.example.test/post/123', {
    file: {
      id: 123,
    },
    reaction: {
      type: 'like',
    },
  });
  manager.updateByDownloadEvent({
    download: {
      progress_percent: 42,
      status: 'downloading',
    },
    file: {
      id: 123,
    },
  });

  assert.equal(upserts.at(-1).badge.progressPercent, 42);
  assert.equal(upserts.at(-1).badge.progressTone, 'active');
});

test('does not render or dim referrer badges without a visible rect', () => {
  const element = createLinkedImage();
  const removals = [];
  const manager = createReferrerBadgeManager({
    getOverlayController: () => ({
      removeBadge: (id) => removals.push(['overlay', id]),
      upsertBadge() {
        throw new Error('hidden referrer assets should not render overlay badges');
      },
    }),
    getVisibleRect: () => null,
    placeBadge() {
      throw new Error('hidden referrer assets should not place badge hosts');
    },
    queueStatusCheck: () => {},
    removeBadgeHost: (id) => removals.push(['host', id]),
    removeDirectBadge: () => {},
    removeOverlayBadge: (id) => removals.push(['overlay', id]),
    viewportPadding: 4,
  });

  manager.sync(element);
  manager.updateByReferrerUrl('https://www.example.test/post/123', {
    reaction: {
      type: 'love',
    },
  });

  assert.equal(element.style.opacity, '');
  assert.equal(
    removals.every(([type, id]) => type === 'host' && id === 'referrer-asset-0'),
    true,
  );
  assert.equal(removals.some(([type]) => type === 'overlay'), false);
});

test('preserves reacted referrer state when the preview source changes', () => {
  const upserts = [];
  const element = createLinkedImage();
  const manager = createReferrerBadgeManager({
    getCurrentPageUrl: () => 'https://www.example.test/feed',
    getOverlayController: () => ({
      removeBadge: () => {},
      upsertBadge: (id, badge) => upserts.push({ badge, id }),
    }),
    getVisibleRect: () => ({
      bottom: 200,
      left: 20,
      width: 320,
    }),
    queueStatusCheck: () => {},
    removeDirectBadge: () => {},
    removeOverlayBadge: () => {},
    viewportPadding: 4,
  });

  manager.sync(element);
  manager.updateOpenCounts({ 'https://www.example.test/post/123': 1 });
  manager.updateByReferrerUrl('https://www.example.test/post/123', {
    reaction: {
      type: 'love',
    },
  });
  upserts.length = 0;
  element.currentSrc = 'https://cdn.example.test/media/art-preview-v2.jpg';

  manager.positionKnown();

  assert.equal(upserts.at(-1).badge.activeReaction, 'love');
  assert.equal(upserts.at(-1).badge.referrerStatus, null);
});

test('queues known referrers for a forced refresh', () => {
  const queued = [];
  const element = createLinkedImage();
  const manager = createReferrerBadgeManager({
    getOverlayController: () => ({
      removeBadge: () => {},
      upsertBadge: () => {},
    }),
    getVisibleRect: () => ({
      bottom: 200,
      left: 20,
      width: 320,
    }),
    queueStatusCheck: (referrerUrl, options) => {
      queued.push({ options, referrerUrl });
    },
    removeDirectBadge: () => {},
    removeOverlayBadge: () => {},
    viewportPadding: 4,
  });

  manager.sync(element);
  queued.length = 0;

  manager.refreshKnownReferrers();

  assert.deepEqual(queued, [{
    options: {
      refreshOpenCounts: true,
      refreshStatus: true,
    },
    referrerUrl: 'https://www.example.test/post/123',
  }]);
});

test('queues referrer match status with a short lookup id', () => {
  const queued = [];
  const element = createLinkedImage();
  const manager = createReferrerBadgeManager({
    decorateAsset: (asset) => ({
      ...asset,
      matchIdentity: {
        match_by: 'referrer',
        match_url: asset.referrerUrl,
        rule_digest: 'rule-example',
        rule_id: 'example-referrer',
      },
    }),
    getOverlayController: () => ({
      removeBadge: () => {},
      upsertBadge: () => {},
    }),
    getVisibleRect: () => ({
      bottom: 200,
      left: 20,
      width: 320,
    }),
    queueStatusCheck: (referrerUrl, options) => {
      queued.push({ options, referrerUrl });
    },
    removeDirectBadge: () => {},
    removeOverlayBadge: () => {},
    viewportPadding: 4,
  });

  manager.sync(element);

  assert.equal(queued[0].referrerUrl, 'https://www.example.test/post/123');
  assert.match(queued[0].options.matchItem.lookup_id, /^referrer:[a-z0-9]+$/u);
  assert.equal(queued[0].options.matchItem.lookup_id.includes(queued[0].referrerUrl), false);
  assert.equal(queued[0].options.matchItem.match_url, 'https://www.example.test/post/123');
});

function createLinkedImage() {
  const anchor = {
    href: 'https://www.example.test/post/123',
    tagName: 'A',
  };

  return {
    closest: () => anchor,
    currentSrc: 'https://cdn.example.test/media/art.jpg',
    isConnected: true,
    naturalHeight: 720,
    naturalWidth: 1280,
    src: '',
    style: {
      opacity: '',
    },
    tagName: 'IMG',
  };
}
