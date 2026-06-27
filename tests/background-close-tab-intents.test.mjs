import assert from 'node:assert/strict';
import test from 'node:test';

import { closeTabModes } from '../src/shared/close-tab-preferences.js';
import { createCloseTabIntentManager } from '../src/background/close-tab-intents.js';

test('after queue close intents close the sender tab immediately', () => {
  const closedTabs = [];
  const manager = createCloseTabIntentManager({
    tabsApi: {
      remove(tabId) {
        closedTabs.push(tabId);
      },
    },
  });

  const result = manager.armCloseIntent({
    assetUrls: ['https://cdn.example.test/video.mp4'],
    mode: closeTabModes.afterQueue,
    siteDomain: 'x.com',
    tabId: 42,
  });

  assert.deepEqual(result, {
    armed: true,
    closed: true,
    mode: closeTabModes.afterQueue,
    trackedAssetCount: 1,
  });
  assert.deepEqual(closedTabs, [42]);
});

test('on complete close intents wait for every queued asset', () => {
  const closedTabs = [];
  const manager = createCloseTabIntentManager({
    tabsApi: {
      remove(tabId) {
        closedTabs.push(tabId);
      },
    },
  });

  manager.armCloseIntent({
    assetUrls: [
      'https://cdn.example.test/file-1.jpg',
      'https://cdn.example.test/file-2.jpg',
    ],
    mode: closeTabModes.onComplete,
    siteDomain: 'deviantart.com',
    tabId: 7,
  });

  manager.handleDownloadEvent({
    assetUrl: 'https://cdn.example.test/file-1.jpg',
    download: { status: 'completed' },
  });
  assert.deepEqual(closedTabs, []);

  manager.handleDownloadEvent({
    assetUrl: 'https://cdn.example.test/file-2.jpg',
    download: { status: 'completed' },
  });
  assert.deepEqual(closedTabs, [7]);
});

test('failed or canceled tracked downloads keep the tab open and clear the intent', () => {
  const closedTabs = [];
  const manager = createCloseTabIntentManager({
    tabsApi: {
      remove(tabId) {
        closedTabs.push(tabId);
      },
    },
  });

  manager.armCloseIntent({
    assetUrls: ['https://cdn.example.test/file-1.jpg'],
    mode: closeTabModes.onComplete,
    siteDomain: 'youtube.com',
    tabId: 8,
  });
  manager.handleDownloadEvent({
    assetUrl: 'https://cdn.example.test/file-1.jpg',
    download: { status: 'failed' },
  });
  manager.handleDownloadEvent({
    assetUrl: 'https://cdn.example.test/file-1.jpg',
    download: { status: 'completed' },
  });

  assert.deepEqual(closedTabs, []);
});
