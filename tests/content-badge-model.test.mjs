import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createBadgePresentation,
  createReferrerBadgePresentation,
  createBadgeStyle,
  formatResolutionLabel,
} from '../src/content/badge-model.js';

test('formats static asset badge resolution labels', () => {
  assert.equal(formatResolutionLabel({ resolution: '1280x720' }), '1280x720');
  assert.equal(formatResolutionLabel({ resolution: null }), null);
});

test('creates static asset badge positioning styles', () => {
  assert.deepEqual(createBadgeStyle(null, 4), { display: 'none' });
  assert.deepEqual(
    createBadgeStyle({
      bottom: 504,
      left: 100,
      width: 320,
    }, 4),
    {
      display: 'flex',
      left: '260px',
      maxWidth: '312px',
      top: '500px',
    },
  );
  assert.deepEqual(
    createBadgeStyle({
      bottom: 504,
      left: 100,
      width: 320,
    }, 4, { type: 'video' }),
    {
      display: 'flex',
      left: '260px',
      maxWidth: '312px',
      top: '452px',
    },
  );
  assert.deepEqual(
    createBadgeStyle({
      bottom: 504,
      left: 100,
      width: 320,
    }, 4, { type: 'image' }, { placement: 'bottom-right' }),
    {
      display: 'flex',
      left: '416px',
      maxWidth: '312px',
      top: '500px',
      transform: 'translate(-100%, -100%)',
    },
  );
});

test('creates static asset badge presentation data', () => {
  assert.deepEqual(
    createBadgePresentation({
      resolution: '640x480',
      source: 'https://example.test/art.png',
      type: 'image',
    }, null, 4),
    {
      activeReaction: null,
      atlasFileUrl: null,
      batch: null,
      canDeleteFile: false,
      download: null,
      file: null,
      isBusy: false,
      isDeleting: false,
      progressLabel: '',
      progressPercent: 0,
      progressTone: 'idle',
      reaction: null,
      resolutionLabel: '640x480',
      source: 'https://example.test/art.png',
      style: {
        display: 'none',
      },
      submittingReaction: null,
      timestampLabel: null,
      type: 'image',
    },
  );
});

test('formats badge state from Atlas asset status payloads', () => {
  assert.deepEqual(
    createBadgePresentation({
      resolution: null,
      source: 'https://example.test/downloaded.jpg',
      type: 'image',
    }, null, 4, {
      download: {
        downloaded_at: '2025-01-02T03:04:05',
        file_id: null,
        progress_percent: 100,
        status: 'completed',
      },
      file: {
        atlas_url: 'https://atlas.test/browse/file/123',
        id: 123,
      },
      reaction: { type: 'love' },
    }),
    {
      activeReaction: 'love',
      atlasFileUrl: 'https://atlas.test/browse/file/123',
      batch: null,
      canDeleteFile: true,
      download: {
        downloaded_at: '2025-01-02T03:04:05',
        file_id: null,
        progress_percent: 100,
        status: 'completed',
      },
      file: {
        atlas_url: 'https://atlas.test/browse/file/123',
        id: 123,
      },
      isBusy: false,
      isDeleting: false,
      progressLabel: 'completed · 100%',
      progressPercent: 100,
      progressTone: 'success',
      reaction: 'love',
      resolutionLabel: null,
      source: 'https://example.test/downloaded.jpg',
      style: {
        display: 'none',
      },
      submittingReaction: null,
      timestampLabel: '01-02-2025 03:04:05',
      type: 'image',
    },
  );
});

test('formats active transfer stages without treating idle assets as complete', () => {
  assert.equal(
    createBadgePresentation({
      resolution: null,
      source: 'https://example.test/idle.jpg',
      type: 'image',
    }, null, 4).progressPercent,
    0,
  );

  assert.deepEqual(
    createBadgePresentation({
      resolution: null,
      source: 'https://example.test/downloading.jpg',
      type: 'image',
    }, null, 4, {
      download: {
        progress_percent: 42,
        status: 'downloading',
      },
    }),
    {
      activeReaction: null,
      atlasFileUrl: null,
      batch: null,
      canDeleteFile: false,
      download: {
        downloaded_at: null,
        file_id: null,
        progress_percent: 42,
        status: 'downloading',
      },
      file: null,
      isBusy: false,
      isDeleting: false,
      progressLabel: 'downloading · 42%',
      progressPercent: 42,
      progressTone: 'active',
      reaction: null,
      resolutionLabel: null,
      source: 'https://example.test/downloading.jpg',
      style: {
        display: 'none',
      },
      submittingReaction: null,
      timestampLabel: null,
      type: 'image',
    },
  );
});

test('active transfer progress takes precedence over stale downloaded timestamps', () => {
  assert.deepEqual(
    createBadgePresentation({
      resolution: null,
      source: 'https://example.test/restarted.jpg',
      type: 'image',
    }, null, 4, {
      download: {
        downloaded_at: '2025-01-02T03:04:05',
        file_id: 123,
        progress_percent: 12,
        status: 'downloading',
      },
      file: {
        atlas_url: 'https://atlas.test/browse/file/123',
        id: 123,
      },
      reaction: { type: 'like' },
    }),
    {
      activeReaction: 'like',
      atlasFileUrl: null,
      batch: null,
      canDeleteFile: false,
      download: {
        downloaded_at: '2025-01-02T03:04:05',
        file_id: 123,
        progress_percent: 12,
        status: 'downloading',
      },
      file: {
        atlas_url: 'https://atlas.test/browse/file/123',
        id: 123,
      },
      isBusy: false,
      isDeleting: false,
      progressLabel: 'downloading · 12%',
      progressPercent: 12,
      progressTone: 'active',
      reaction: 'like',
      resolutionLabel: null,
      source: 'https://example.test/restarted.jpg',
      style: {
        display: 'none',
      },
      submittingReaction: null,
      timestampLabel: null,
      type: 'image',
    },
  );
});

test('tracks clicked reaction spinner before the active state changes', () => {
  const badge = createBadgePresentation({
    resolution: null,
    source: 'https://example.test/pending.jpg',
    type: 'image',
  }, null, 4, {
    isBusy: true,
    submittingReaction: 'funny',
  });

  assert.equal(badge.activeReaction, null);
  assert.equal(badge.submittingReaction, 'funny');
  assert.equal(badge.isBusy, true);
});

test('creates batch presentation data when the page has related files', () => {
  const badge = createBadgePresentation({
    resolution: null,
    source: 'https://example.test/file-1.jpg',
    type: 'image',
  }, null, 4, {
    batch: {
      available: true,
      checked: true,
    },
  });

  assert.deepEqual(badge.batch, {
    available: true,
    checked: true,
  });
});

test('marks blacklist as the active reaction from blacklisted state', () => {
  const badge = createBadgePresentation({
    resolution: null,
    source: 'https://example.test/blocked.jpg',
    type: 'image',
  }, null, 4, {
    blacklisted_at: '2025-01-02T03:04:05',
  });

  assert.equal(badge.activeReaction, 'blacklist');
  assert.equal(badge.timestampLabel, '01-02-2025 03:04:05');
});

test('creates compact referrer badge presentation data', () => {
  const badge = createReferrerBadgePresentation({
    referrerUrl: 'https://www.example.test/post/123',
    resolution: '1280x720',
    source: 'https://cdn.example.test/referrer-preview.jpg',
    type: 'image',
  }, {
    bottom: 504,
    left: 100,
    width: 320,
  }, 4, {
    download: {
      downloaded_at: '2025-01-02T03:04:05',
      progress_percent: 100,
      status: 'completed',
    },
    file: {
      atlas_url: 'https://atlas.test/browse/file/321',
      id: 321,
    },
    reaction: { type: 'like' },
  });

  assert.equal(badge.variant, 'referrer');
  assert.equal(badge.activeReaction, 'like');
  assert.equal(badge.progressPercent, 100);
  assert.equal(Object.hasOwn(badge, 'atlasFileUrl'), false);
  assert.equal(Object.hasOwn(badge, 'canDeleteFile'), false);
  assert.equal(Object.hasOwn(badge, 'progressLabel'), false);
  assert.equal(Object.hasOwn(badge, 'summary'), false);
  assert.equal(Object.hasOwn(badge, 'timestampLabel'), false);
  assert.equal(Object.hasOwn(badge, 'type'), false);
  assert.deepEqual(badge.style, {
    display: 'flex',
    height: '50px',
    left: '416px',
    maxWidth: '40px',
    top: '500px',
    transform: 'translate(-100%, -100%)',
    width: '40px',
  });
});
