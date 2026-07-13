import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

const source = fs.readFileSync(
  path.resolve(import.meta.dirname, '../src/content/AssetSheet.vue'),
  'utf8',
);

test('asset sheet exposes an accessible modal fallback for recognized assets', () => {
  assert.match(source, /Recognized assets/);
  assert.match(source, /aria-haspopup="dialog"/);
  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /keepFocusInSheet/);
  assert.match(source, /document\.documentElement\.style\.overflow = "hidden"/);
});

test('asset sheet uses the shared reaction contract and busy state', () => {
  assert.match(source, /listReactionSheetAssets\(props\.badges\)/);
  assert.match(source, /emit\('react', \{ id: asset\.id, type: reaction\.type \}\)/);
  assert.match(source, /asset\.isBusy \|\| asset\.isDeleting/);
  assert.match(source, /asset\.submittingReaction === reaction\.type/);
  assert.match(source, /asset\.activeReaction === reaction\.type/);
  assert.match(source, /reactionFromBadgeShortcutEvent/);
  assert.match(source, /handleCardShortcut/);
  assert.match(source, /@click="handleCardShortcut\(\$event, asset\)"/);
  assert.match(source, /@mousedown="handleCardShortcut\(\$event, asset\)"/);
  assert.match(source, /@contextmenu="handleCardShortcut\(\$event, asset\)"/);
});

test('asset sheet places a media preview before card metadata', () => {
  assert.match(source, /AssetSheetPreview/);
  assert.match(source, /<AssetSheetPreview :asset="asset" \/>/);
});
