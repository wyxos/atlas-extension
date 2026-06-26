import assert from 'node:assert/strict';
import test from 'node:test';

import { getOverlayStyles } from '../src/content/overlay-styles.js';

test('uses Atlas reaction active colors and loading spinner styles', () => {
  const styles = getOverlayStyles();

  assert.match(styles, /\.atlas-static-icon-love\.atlas-static-icon-active[\s\S]*background: #ef4444/);
  assert.match(styles, /\.atlas-static-icon-like\.atlas-static-icon-active[\s\S]*background: #0466c8/);
  assert.match(styles, /\.atlas-static-icon-blacklist\.atlas-static-icon-active[\s\S]*background: #8d0a0c/);
  assert.match(styles, /\.atlas-static-icon-funny\.atlas-static-icon-active[\s\S]*background: #eab308/);
  assert.match(styles, /@keyframes atlas-badge-spin/);
  assert.match(styles, /\.atlas-static-spinner[\s\S]*animation: atlas-badge-spin/);
});

test('uses a compact non-interactive referrer badge surface', () => {
  const styles = getOverlayStyles();

  assert.match(styles, /\[data-atlas-referrer-badge\][\s\S]*height: 50px/);
  assert.match(styles, /\[data-atlas-referrer-badge\][\s\S]*width: 40px/);
  assert.match(styles, /\.atlas-referrer-reaction svg[\s\S]*height: 30px[\s\S]*width: 30px/);
  assert.match(styles, /\.atlas-referrer-reaction-like[\s\S]*background: #0466c8/);
  assert.match(styles, /\.atlas-referrer-progress/);
  assert.doesNotMatch(styles, /atlas-referrer-progress-text/);
  assert.doesNotMatch(styles, /atlas-referrer-timestamp/);
  assert.doesNotMatch(styles, /atlas-static-icon-readonly/);
});
