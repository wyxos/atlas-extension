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

test('allows pointer events on visible asset badge shortcut surfaces', () => {
  const styles = getOverlayStyles();

  assert.match(styles, /\.atlas-static-meta[\s\S]*pointer-events: auto/);
  assert.match(styles, /\.atlas-static-icons[\s\S]*pointer-events: auto/);
  assert.match(styles, /\.atlas-static-progress[\s\S]*pointer-events: auto/);
});

test('styles the fallback asset trigger and responsive modal sheet', () => {
  const styles = getOverlayStyles();

  assert.match(styles, /\.atlas-asset-sheet-trigger[\s\S]*position: fixed/);
  assert.match(styles, /\.atlas-asset-sheet[\s\S]*width: min\(420px, 100vw\)/);
  assert.match(styles, /\.atlas-asset-sheet-list[\s\S]*overflow-y: auto/);
  assert.match(styles, /\.atlas-asset-sheet-fade-leave-active/);
  assert.match(styles, /@media \(max-width: 520px\)[\s\S]*width: 100vw/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styles, /\.atlas-asset-sheet-trigger[\s\S]*border-radius: 4px/);
  assert.match(styles, /\.atlas-asset-sheet-item[\s\S]*border-radius: 4px/);
  assert.match(styles, /\.atlas-asset-sheet-preview[\s\S]*grid-area: preview/);
  assert.match(styles, /\.atlas-asset-sheet-preview-media[\s\S]*opacity: 0/);
  assert.doesNotMatch(styles, /border-radius: 999px/);
});
