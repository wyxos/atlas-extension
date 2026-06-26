import assert from 'node:assert/strict';
import test from 'node:test';

import {
  listenForPageLocationChanges,
  locationBridgeEventName,
} from '../src/content/content-runtime.js';

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
