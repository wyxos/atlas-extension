import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveVisibleRect } from '../src/content/visible-rect.js';

test('keeps wide asset badges hidden for narrow previews by default', () => {
  assert.equal(resolveVisibleRect(fakeElementRect({
    bottom: 100,
    height: 80,
    left: 10,
    right: 90,
    top: 20,
    width: 80,
  }), 4, viewportContext()), null);
});

test('allows compact referrer badges on narrow previews', () => {
  assert.deepEqual(resolveVisibleRect(fakeElementRect({
    bottom: 100,
    height: 80,
    left: 10,
    right: 90,
    top: 20,
    width: 80,
  }), 4, {
    ...viewportContext(),
    minVisibleWidth: 40,
  }), {
    bottom: 100,
    left: 10,
    width: 80,
  });
});

function viewportContext() {
  return {
    documentRef: {
      documentElement: {
        clientHeight: 600,
        clientWidth: 800,
      },
    },
    windowRef: {
      innerHeight: 600,
      innerWidth: 800,
    },
  };
}

function fakeElementRect(rect) {
  return {
    getBoundingClientRect: () => rect,
  };
}
