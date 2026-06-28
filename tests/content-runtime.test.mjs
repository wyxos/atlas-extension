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

test('observes visibility-related media attributes for rescan', () => {
  let observedOptions = null;
  const originalDocument = globalThis.document;
  const originalMutationObserver = globalThis.MutationObserver;
  const originalWindow = globalThis.window;
  const originalChrome = globalThis.chrome;

  globalThis.MutationObserver = class FakeMutationObserver {
    observe(_target, options) {
      observedOptions = options;
    }
  };
  globalThis.window = {
    addEventListener() {},
    history: {
      pushState() {},
      replaceState() {},
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
      scanAssets() {},
      schedulePositionUpdate() {},
      updateBadgeStateBySource() {},
    });
  } finally {
    globalThis.MutationObserver = originalMutationObserver;
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
    globalThis.chrome = originalChrome;
  }

  assert.deepEqual(observedOptions.attributeFilter, [
    'class',
    'hidden',
    'href',
    'poster',
    'src',
    'srcset',
    'style',
  ]);
  assert.equal(observedOptions.attributes, true);
  assert.equal(observedOptions.subtree, true);
});

test('download events are delegated for state and cache updates', () => {
  const calls = [];
  const listeners = [];
  const originalDocument = globalThis.document;
  const originalMutationObserver = globalThis.MutationObserver;
  const originalWindow = globalThis.window;
  const originalChrome = globalThis.chrome;
  const payload = {
    assetUrl: 'https://cdn.example.test/file.jpg',
    download: {
      progress_percent: 42,
      status: 'downloading',
    },
    referrerUrl: 'https://www.example.test/post/123',
  };

  globalThis.MutationObserver = class FakeMutationObserver {
    observe() {}
  };
  globalThis.window = {
    addEventListener() {},
    history: {
      pushState() {},
      replaceState() {},
    },
  };
  globalThis.document = {
    documentElement: {},
  };
  globalThis.chrome = {
    runtime: {
      onMessage: {
        addListener(listener) {
          listeners.push(listener);
        },
      },
    },
  };

  try {
    startContentRuntime({
      getOpenReferrerCounts: () => ({}),
      handleAssetShortcut() {},
      handleDownloadEvent: (eventPayload) => calls.push(eventPayload),
      mergeOpenReferrerCounts() {},
      referrerBadges: {
        updateByDownloadEvent() {
          throw new Error('download event should be handled by handleDownloadEvent');
        },
        updateOpenCounts() {},
      },
      referrerOpenGuard: {
        handleBrowserEvent() {},
      },
      scanAssets() {},
      schedulePositionUpdate() {},
      updateBadgeStateBySource() {
        throw new Error('download event should be handled by handleDownloadEvent');
      },
    });

    listeners.forEach((listener) => listener({
      payload,
      type: 'atlas-extension.download-event',
    }));
  } finally {
    globalThis.MutationObserver = originalMutationObserver;
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
    globalThis.chrome = originalChrome;
  }

  assert.deepEqual(calls, [payload]);
});

test('manual popup scans rescan assets through the existing runtime pipeline', () => {
  const calls = [];
  const listeners = [];
  const responses = [];
  const originalDocument = globalThis.document;
  const originalMutationObserver = globalThis.MutationObserver;
  const originalWindow = globalThis.window;
  const originalChrome = globalThis.chrome;

  globalThis.MutationObserver = class FakeMutationObserver {
    observe() {}
  };
  globalThis.window = {
    addEventListener() {},
    history: {
      pushState() {},
      replaceState() {},
    },
  };
  globalThis.document = {
    documentElement: {},
  };
  globalThis.chrome = {
    runtime: {
      onMessage: {
        addListener(listener) {
          listeners.push(listener);
        },
      },
    },
  };

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

    calls.length = 0;
    const handled = listeners.map((listener) => listener({
      type: 'atlas-extension.manual-scan',
    }, {}, (response) => responses.push(response)));

    assert.equal(handled.includes(false), true);
  } finally {
    globalThis.MutationObserver = originalMutationObserver;
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
    globalThis.chrome = originalChrome;
  }

  assert.deepEqual(calls, [
    ['scan', 'document'],
    'positionBadges',
  ]);
  assert.deepEqual(responses, [{
    ok: true,
    payload: {
      scanned: true,
    },
  }]);
});

test('page activation rescans assets and refreshes known referrers', () => {
  const calls = [];
  const listeners = {};
  const originalDocument = globalThis.document;
  const originalMutationObserver = globalThis.MutationObserver;
  const originalWindow = globalThis.window;
  const originalChrome = globalThis.chrome;

  globalThis.MutationObserver = class FakeMutationObserver {
    observe() {}
  };
  globalThis.window = {
    addEventListener(type, handler) {
      listeners[`window:${type}`] = handler;
    },
    history: {
      pushState() {},
      replaceState() {},
    },
    setTimeout(callback, delay) {
      calls.push(['timeout', delay]);
      callback();

      return 1;
    },
  };
  globalThis.document = {
    addEventListener(type, handler) {
      listeners[`document:${type}`] = handler;
    },
    documentElement: {},
    visibilityState: 'hidden',
  };
  globalThis.chrome = undefined;

  try {
    startContentRuntime({
      getOpenReferrerCounts: () => ({}),
      handleAssetShortcut() {},
      mergeOpenReferrerCounts() {},
      referrerBadges: {
        refreshKnownReferrers(options) {
          calls.push(['refreshReferrers', options]);
        },
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

    calls.length = 0;
    globalThis.document.visibilityState = 'visible';
    listeners['document:visibilitychange']();
  } finally {
    globalThis.MutationObserver = originalMutationObserver;
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
    globalThis.chrome = originalChrome;
  }

  assert.deepEqual(calls, [
    ['timeout', 75],
    ['scan', 'document'],
    ['refreshReferrers', {
      refreshOpenCounts: true,
      refreshStatus: true,
    }],
    'positionBadges',
  ]);
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
