import assert from 'node:assert/strict';
import test from 'node:test';

import { closeTabModes } from '../src/shared/close-tab-preferences.js';
import {
  armCloseTabForReaction,
  queuedAssetUrlsFromReactionPayload,
} from '../src/content/close-tab-reactions.js';

test('extracts only queued download asset urls from single and batch reactions', () => {
  assert.deepEqual(queuedAssetUrlsFromReactionPayload({
    asset_url: 'https://cdn.example.test/original.jpg',
    download: { requested: true },
    file: { url: 'https://cdn.example.test/canonical.jpg' },
  }), ['https://cdn.example.test/canonical.jpg']);

  assert.deepEqual(queuedAssetUrlsFromReactionPayload({
    items: [
      {
        asset_url: 'https://cdn.example.test/file-1.jpg',
        download: { requested: true },
      },
      {
        asset_url: 'https://cdn.example.test/file-2.jpg',
        download: { requested: false },
        file: { url: 'https://cdn.example.test/canonical-2.jpg' },
      },
      {
        download: { requested: true },
      },
    ],
  }), ['https://cdn.example.test/file-1.jpg']);
});

test('arms close intents using the page site domain and configured mode', async () => {
  const intents = [];

  await armCloseTabForReaction({
    asset_url: 'https://cdn.example.test/video.mp4',
    download: { requested: true },
    file: { url: 'https://cdn.example.test/video.mp4' },
  }, {
    async loadModeForSiteDomain(siteDomain) {
      assert.equal(siteDomain, 'x.com');

      return closeTabModes.afterQueue;
    },
    locationContext: {
      href: 'https://www.x.com/user/status/123',
    },
    sendIntent(intent) {
      intents.push(intent);
    },
  });

  assert.deepEqual(intents, [{
    assetUrls: ['https://cdn.example.test/video.mp4'],
    mode: closeTabModes.afterQueue,
    siteDomain: 'x.com',
  }]);
});

test('does not arm close intents when mode is off or no download was queued', async () => {
  const intents = [];

  await armCloseTabForReaction({
    asset_url: 'https://cdn.example.test/video.mp4',
    download: { requested: false },
  }, {
    async loadModeForSiteDomain() {
      return closeTabModes.onComplete;
    },
    locationContext: {
      href: 'https://www.youtube.com/watch?v=1',
    },
    sendIntent(intent) {
      intents.push(intent);
    },
  });

  await armCloseTabForReaction({
    asset_url: 'https://cdn.example.test/video.mp4',
    download: { requested: true },
  }, {
    async loadModeForSiteDomain() {
      return closeTabModes.off;
    },
    locationContext: {
      href: 'https://www.youtube.com/watch?v=1',
    },
    sendIntent(intent) {
      intents.push(intent);
    },
  });

  assert.deepEqual(intents, []);
});
