import assert from 'node:assert/strict';
import test from 'node:test';

import { createReferrerOpenGuard } from '../src/content/referrer-open-guard.js';

test('confirms before opening a reacted referrer', async () => {
  const confirmed = [];
  const navigations = [];
  const event = createClickEvent('https://example.test/post#one');
  const guard = createReferrerOpenGuard({
    confirmOpen: (request) => {
      confirmed.push(request);

      return Promise.resolve(true);
    },
    getAtlasState: () => ({ reaction: { type: 'like' } }),
    getCurrentPageUrl: () => 'https://example.test/feed',
    getOpenCounts: () => ({}),
    navigate: (url) => navigations.push(url),
    openInNewTab: () => {},
  });

  assert.equal(await guard.handleEvent(event), true);
  assert.equal(event.defaultPrevented, true);
  assert.equal(confirmed[0].reason, 'reacted');
  assert.deepEqual(navigations, ['https://example.test/post#one']);
});

test('confirms before opening a referrer that is open elsewhere', async () => {
  const openedTabs = [];
  const event = createClickEvent('https://example.test/post#one', {
    button: 1,
    type: 'auxclick',
  });
  const guard = createReferrerOpenGuard({
    confirmOpen: () => Promise.resolve(true),
    getAtlasState: () => ({}),
    getCurrentPageUrl: () => 'https://example.test/feed',
    getOpenCounts: () => ({ 'https://example.test/post#one': 1 }),
    navigate: () => {},
    openInNewTab: (url) => openedTabs.push(url),
  });

  assert.equal(await guard.handleEvent(event), true);
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(openedTabs, ['https://example.test/post#one']);
});

test('allows normal browser handling when a referrer has no guarded state', async () => {
  const event = createClickEvent('https://example.test/post#one');
  const guard = createReferrerOpenGuard({
    confirmOpen: () => Promise.resolve(false),
    getAtlasState: () => ({}),
    getCurrentPageUrl: () => 'https://example.test/feed',
    getOpenCounts: () => ({}),
    navigate: () => {},
    openInNewTab: () => {},
  });

  assert.equal(await guard.handleEvent(event), false);
  assert.equal(event.defaultPrevented, false);
});

function createClickEvent(url, options = {}) {
  const anchor = {
    href: url,
    target: options.target ?? '',
  };

  return {
    altKey: options.altKey ?? false,
    button: options.button ?? 0,
    ctrlKey: options.ctrlKey ?? false,
    defaultPrevented: false,
    metaKey: options.metaKey ?? false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    shiftKey: options.shiftKey ?? false,
    stopImmediatePropagation() {
      this.stopped = true;
    },
    stopPropagation() {
      this.propagationStopped = true;
    },
    target: {
      closest: (selector) => (selector === 'a[href]' ? anchor : null),
    },
    type: options.type ?? 'click',
  };
}
