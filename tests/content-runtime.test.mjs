import assert from 'node:assert/strict';
import test from 'node:test';

import {
  startContentRuntime,
  listenForPageLocationChanges,
  locationBridgeEventName,
} from '../src/content/content-runtime.js';

test('added DOM nodes resync existing badges so late provider context is applied', () => {
  const calls = [];
  const originalDocument = globalThis.document;
  const originalMutationObserver = globalThis.MutationObserver;
  const originalWindow = globalThis.window;
  const originalChrome = globalThis.chrome;
  const addedNode = { id: 'all-images-strip' };
  let mutationCallback = null;

  globalThis.MutationObserver = class FakeMutationObserver {
    constructor(callback) {
      mutationCallback = callback;
    }

    observe(target, options) {
      calls.push(['observe', target, options.childList, options.subtree]);
    }
  };
  globalThis.window = {
    addEventListener(type) {
      calls.push(['listen', type]);
    },
    history: {
      pushState() {},
      replaceState() {},
    },
    setTimeout(callback) {
      calls.push('timeout');
      callback();

      return 1;
    },
  };
  globalThis.document = {
    documentElement: {
      id: 'document-element',
    },
  };
  globalThis.chrome = undefined;

  try {
    startContentRuntime({
      getOpenReferrerCounts: () => ({}),
      handleAssetShortcut() {},
      mergeOpenReferrerCounts() {},
      referrerBadges: {
        updateByDownloadEvent() {},
        updateOpenCounts() {},
      },
      referrerOpenGuard: {
        handleBrowserEvent() {},
      },
      scanAssets(root) {
        calls.push(['scan', root?.id ?? 'document']);
      },
      schedulePositionUpdate() {
        calls.push('positionBadges');
      },
      updateBadgeStateBySource() {},
    });

    mutationCallback([{
      addedNodes: [addedNode],
      type: 'childList',
    }]);
  } finally {
    globalThis.MutationObserver = originalMutationObserver;
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
    globalThis.chrome = originalChrome;
  }

  assert.deepEqual(calls.filter((call) => call[0] === 'scan'), [
    ['scan', 'document'],
    ['scan', 'all-images-strip'],
  ]);
  assert.equal(calls.includes('positionBadges'), true);
});

test('page location changes refresh referrer state and rescan assets', () => {
  const calls = [];
  const listeners = {};
  let scheduledCallback = null;
  const windowContext = {
    history: {
      pushState() {
        calls.push('pushState');

        return 'pushed';
      },
      replaceState() {
        calls.push('replaceState');

        return 'replaced';
      },
    },
    addEventListener(type, handler) {
      listeners[type] = handler;
    },
    setTimeout(callback, delay) {
      calls.push(['timeout', delay]);
      scheduledCallback = callback;

      return 1;
    },
  };

  listenForPageLocationChanges({
    getOpenReferrerCounts: () => ({
      'https://www.example.test/post/123': 1,
    }),
    referrerBadges: {
      updateOpenCounts(counts) {
        calls.push(['counts', counts]);
      },
    },
    refreshAssets() {
      calls.push('refreshAssets');
    },
    schedulePositionUpdate() {
      calls.push('positionBadges');
    },
    windowContext,
  });

  assert.equal(windowContext.history.pushState({}, '', '/next'), 'pushed');
  scheduledCallback();
  assert.deepEqual(calls, [
    'pushState',
    ['timeout', 75],
    ['counts', {
      'https://www.example.test/post/123': 1,
    }],
    'refreshAssets',
    'positionBadges',
  ]);

  calls.length = 0;
  listeners[locationBridgeEventName]();
  scheduledCallback();
  assert.deepEqual(calls, [
    ['timeout', 75],
    ['counts', {
      'https://www.example.test/post/123': 1,
    }],
    'refreshAssets',
    'positionBadges',
  ]);
});
