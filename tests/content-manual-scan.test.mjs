import assert from 'node:assert/strict';
import test from 'node:test';

import { listAssetElements } from '../src/content/asset-scanner.js';
import { describeAssetElement } from '../src/content/assets.js';
import { startContentRuntime } from '../src/content/content-runtime.js';

test('manual scans rediscover late and newly visible media, including before automatic startup', async (t) => {
  const listeners = [];
  const children = [];
  const shadowChildren = [];
  let detected = [];
  let failScan = false;
  let releaseGate;
  const gate = new Promise((resolve) => { releaseGate = resolve; });
  const root = {
    documentElement: {},
    querySelectorAll: (selector) => selector === '*'
      ? [{ shadowRoot: { querySelectorAll: (query) => query === '*' ? [] : shadowChildren } }]
      : children,
  };
  for (const [key, value] of Object.entries({
    document: root,
    window: { addEventListener() {}, history: { pushState() {}, replaceState() {} } },
    MutationObserver: class { observe() {} },
    chrome: { runtime: { onMessage: { addListener: (listener) => listeners.push(listener) } } },
  })) {
    const original = globalThis[key];
    globalThis[key] = value;
    t.after(() => { globalThis[key] = original; });
  }
  startContentRuntime({
    handleAssetShortcut() {},
    getOpenReferrerCounts: () => ({}),
    mergeOpenReferrerCounts() {},
    referrerBadges: { updateByDownloadEvent() {}, updateOpenCounts() {} },
    referrerOpenGuard: { handleBrowserEvent() {} },
    scanAssets: (scanRoot = root) => {
      if (failScan) throw new Error('fixture failure');
      detected = listAssetElements(scanRoot, 'img, video, audio')
        .map((element) => describeAssetElement(element)).filter(Boolean);
    },
    schedulePositionUpdate() {},
    updateBadgeStateBySource() {},
    waitForInitialDomMutationWindow: () => gate,
  });
  const scan = () => {
    const responses = [];
    for (const listener of listeners) {
      listener({ type: 'atlas-extension.manual-scan' }, {}, (response) => responses.push(response));
    }
    assert.equal(responses.length, 1);
    return responses[0];
  };
  const video = { tagName: 'VIDEO', src: 'https://example.test/late.mp4' };
  children.push(video);
  assert.deepEqual(scan(), { ok: true, payload: { scanned: true } });
  assert.equal(detected[0].source, video.src);

  releaseGate();
  await gate;
  children.length = 0;
  scan();
  assert.deepEqual(detected, []);

  // No mutation notification: the user's request itself must walk the current tree.
  children.push(video);
  const revealed = { tagName: 'VIDEO', src: 'https://example.test/revealed.mp4', hidden: true };
  children.push(revealed);
  const shadowVideo = { tagName: 'VIDEO', src: 'https://example.test/shadow.mp4' };
  shadowChildren.push(shadowVideo);
  scan();
  assert.deepEqual(detected.map((asset) => asset.source), [video.src, shadowVideo.src]);
  revealed.hidden = false;
  video.src = 'https://example.test/replaced.mp4';
  scan();
  assert.deepEqual(detected.map((asset) => asset.source), [video.src, revealed.src, shadowVideo.src]);
  scan();
  assert.equal(detected.length, 3);

  failScan = true;
  assert.deepEqual(scan(), { ok: false, error: 'The page scan failed. Try again.' });
});
