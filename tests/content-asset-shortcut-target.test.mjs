import assert from 'node:assert/strict';
import test from 'node:test';

import { findAssetShortcutFallback } from '../src/content/asset-shortcut-target.js';
import { handleAssetShortcutEvent } from '../src/content/asset-shortcuts.js';

const mediaRect = { left: 100, top: 100, right: 700, bottom: 500, width: 600, height: 400 };

function node(parentNode = null, options = {}) {
  return {
    parentNode,
    isConnected: true,
    tagName: 'DIV',
    getBoundingClientRect: () => mediaRect,
    closest: () => null,
    ...options,
  };
}

function player() {
  const body = node(null, { tagName: 'BODY' });
  const container = node(body);
  const video = node(container, { tagName: 'VIDEO' });
  const overlay = node(container);
  return { body, container, video, overlay };
}

function shortcut(target, options = {}) {
  return {
    target,
    altKey: true,
    type: 'click',
    button: 0,
    clientX: 300,
    clientY: 300,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.propagationStopped = true; },
    ...options,
  };
}

function dispatch(event, assetIds, isAssetVisible = () => true) {
  const reactions = [];
  const handled = handleAssetShortcutEvent(event, {
    getAssetIdForElement: (element) => assetIds.get(element),
    getFallbackAssetId: (input) => findAssetShortcutFallback(input, { assetIds, isAssetVisible }),
    onReact: (reaction) => reactions.push(reaction),
  });
  return { handled, reactions };
}

test('routes all three shortcuts through a sibling video overlay to the registered widget', () => {
  const { video, overlay } = player();
  const assets = new Map([[video, 'video-widget']]);
  for (const [type, button, reaction] of [
    ['click', 0, 'love'], ['mousedown', 1, 'like'], ['contextmenu', 2, 'blacklist'],
  ]) {
    const event = shortcut(overlay, { type, button });
    assert.deepEqual(dispatch(event, assets), {
      handled: true, reactions: [{ id: 'video-widget', type: reaction }],
    });
    assert.equal(event.defaultPrevented, true);
    assert.equal(event.propagationStopped, true);
  }
});

test('resolves a player play button, including an icon inside it', () => {
  const { video, overlay } = player();
  const button = node(overlay, { tagName: 'BUTTON' });
  const icon = node(button, { closest: (selector) => selector.split(',').includes('button') ? button : null });
  assert.deepEqual(dispatch(shortcut(icon), new Map([[video, 'video-widget']])), {
    handled: true, reactions: [{ id: 'video-widget', type: 'love' }],
  });
});

test('prefers direct media targeting without invoking the fallback', () => {
  const { video } = player();
  const event = shortcut(video);
  assert.equal(handleAssetShortcutEvent(event, {
    getAssetIdForElement: () => 'direct-widget',
    getFallbackAssetId: () => assert.fail('direct targeting must win'),
  }), true);
});

test('does not intercept ordinary clicks or inputs, sliders, and Atlas controls', () => {
  const { video, overlay } = player();
  const assets = new Map([[video, 'video-widget']]);
  const events = [shortcut(overlay, { altKey: false })];
  for (const selector of [
    'input', 'select', 'textarea', '[contenteditable]:not([contenteditable="false"])',
    '[role="textbox"]', '[role="slider"]', '[data-atlas-asset-badge="true"]',
    '[data-atlas-extension-badge-host]', '#atlas-extension-asset-overlay',
  ]) {
    const control = node(overlay);
    control.closest = (selectors) => selectors.split(',').includes(selector) ? control : null;
    events.push(shortcut(control));
  }
  for (const event of events) {
    assert.deepEqual(dispatch(event, assets), { handled: false, reactions: [] });
    assert.equal(event.defaultPrevented, undefined);
  }
});

test('does not select nearby media, unrelated page overlays, or missing coordinates', () => {
  const { video, overlay, body } = player();
  const assets = new Map([[video, 'video-widget']]);
  for (const event of [
    shortcut(overlay, { clientX: 701 }),
    shortcut(overlay, { clientY: 99 }),
    shortcut(overlay, { clientX: undefined }),
    shortcut(overlay, { clientY: NaN }),
    shortcut(node(body)),
    shortcut(body),
  ]) {
    assert.deepEqual(dispatch(event, assets), { handled: false, reactions: [] });
    assert.equal(event.defaultPrevented, undefined);
  }
});

test('skips disconnected, hidden, and unregistered media', () => {
  const { video, overlay } = player();
  const assets = new Map([[video, 'video-widget']]);
  assert.equal(dispatch(shortcut(overlay), assets, () => false).handled, false);
  video.isConnected = false;
  assert.equal(dispatch(shortcut(overlay), assets).handled, false);
  assert.equal(dispatch(shortcut(overlay), new Map()).handled, false);
});

test('uses pointer location to distinguish media within a multi-file post', () => {
  const { video, overlay, container } = player();
  const other = node(container, {
    getBoundingClientRect: () => ({ ...mediaRect, left: 700, right: 1300 }),
  });
  const assets = new Map([[other, 'other-widget'], [video, 'video-widget']]);
  assert.deepEqual(dispatch(shortcut(overlay), assets).reactions, [{ id: 'video-widget', type: 'love' }]);
  assert.deepEqual(dispatch(shortcut(overlay, { clientX: 800 }), assets).reactions, [{ id: 'other-widget', type: 'love' }]);
});

test('uses the nearest container and rejects indistinguishable overlapping media', () => {
  const { video, overlay, container } = player();
  const other = node(container);
  const assets = new Map([[other, 'other-widget'], [video, 'video-widget']]);
  assert.equal(dispatch(shortcut(overlay), assets).handled, false);
  const inner = node(container);
  video.parentNode = inner;
  overlay.parentNode = inner;
  assert.deepEqual(dispatch(shortcut(overlay), assets).reactions, [{ id: 'video-widget', type: 'love' }]);
});

test('handles media and overlays across an open shadow root', () => {
  const { video, overlay, container } = player();
  const host = node(container);
  const shadowRoot = { getRootNode: () => shadowRoot, host };
  video.parentNode = shadowRoot;
  const event = shortcut(overlay, { composedPath: () => [overlay, container] });
  assert.deepEqual(dispatch(event, new Map([[video, 'video-widget']])).reactions, [
    { id: 'video-widget', type: 'love' },
  ]);
});
