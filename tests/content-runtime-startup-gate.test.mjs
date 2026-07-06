import assert from 'node:assert/strict';
import test from 'node:test';

import { startContentRuntime } from '../src/content/content-runtime.js';

test('defers first DOM scan and observer attachment until the initial mutation gate settles', async () => {
  const calls = [];
  const originalDocument = globalThis.document;
  const originalMutationObserver = globalThis.MutationObserver;
  const originalWindow = globalThis.window;
  const originalChrome = globalThis.chrome;
  let releaseGate = null;
  let observeCount = 0;
  const initialGate = new Promise((resolve) => {
    releaseGate = resolve;
  });

  globalThis.MutationObserver = class FakeMutationObserver {
    observe() {
      observeCount += 1;
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
      waitForInitialDomMutationWindow: () => initialGate,
    });

    assert.deepEqual(calls.filter((call) => call[0] === 'scan'), []);
    assert.equal(observeCount, 0);
    assert.equal(calls.some((call) => call[0] === 'listen' && call[1] === 'click'), true);

    releaseGate();
    await initialGate;
    await Promise.resolve();
  } finally {
    globalThis.MutationObserver = originalMutationObserver;
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
    globalThis.chrome = originalChrome;
  }

  assert.deepEqual(calls.filter((call) => call[0] === 'scan'), [
    ['scan', 'document'],
  ]);
  assert.equal(observeCount, 1);
});
