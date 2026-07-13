import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

const source = fs.readFileSync(
  path.resolve(import.meta.dirname, '../src/content/AssetSheetPreview.vue'),
  'utf8',
);

test('asset sheet preview hides media until ready and exposes a failure fallback', () => {
  assert.match(source, /atlas-asset-sheet-preview-media-ready/);
  assert.match(source, /Loading asset preview/);
  assert.match(source, /@load="markReady"/);
  assert.match(source, /@loadedmetadata="markReady"/);
  assert.match(source, /@error="markFailed"/);
  assert.match(source, /fallbackIcon/);
});
