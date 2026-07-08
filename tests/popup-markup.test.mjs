import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const popupHtml = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');

test('popup exposes a manual scan action', () => {
  assert.match(popupHtml, /Atlas Extension/);
  assert.match(popupHtml, /atlas-popup-scan/);
  assert.match(popupHtml, /atlas-popup-reload/);
  assert.match(popupHtml, /atlas-popup-load-next-tabs/);
  assert.match(popupHtml, /atlas-popup-load-next-tabs-limit/);
  assert.match(popupHtml, /atlas-popup-load-next-tabs-decrement/);
  assert.match(popupHtml, /atlas-popup-load-next-tabs-increment/);
  assert.match(popupHtml, /atlas-popup-copy-tab-links/);
  assert.match(popupHtml, /atlas-popup-open-clipboard-links/);
  assert.doesNotMatch(popupHtml, /atlas-popup-reaction-widget-visibility/);
  assert.match(popupHtml, /\/src\/popup\/main\.js/);
  assert.match(popupHtml, /Scan page/);
  assert.match(popupHtml, /Reload extension/);
  assert.match(popupHtml, /Load next tabs/);
  assert.match(popupHtml, /Copy open links/);
  assert.match(popupHtml, /Open clipboard links/);
  assert.doesNotMatch(popupHtml, /Hide reaction widget/);
  assert.doesNotMatch(popupHtml, /Show reaction widget/);
});
