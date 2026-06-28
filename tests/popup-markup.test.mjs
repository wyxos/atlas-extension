import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const popupHtml = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');

test('popup exposes a manual scan action', () => {
  assert.match(popupHtml, /Atlas Extension/);
  assert.match(popupHtml, /atlas-popup-scan/);
  assert.match(popupHtml, /\/src\/popup\/main\.js/);
  assert.match(popupHtml, /Scan page/);
});
