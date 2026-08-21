import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

const source = fs.readFileSync(
  path.resolve(import.meta.dirname, '../src/content/AssetBadge.vue'),
  'utf8',
);

test('asset badge uses icon metadata instead of Atlas fallback or type text', () => {
  assert.doesNotMatch(source, />Atlas</);
  assert.doesNotMatch(source, /badge\.summary/);
  assert.match(source, /badge\.resolutionLabel/);
  assert.match(source, /ImageIcon/);
  assert.match(source, /Video/);
  assert.match(source, /Volume2/);
});

test('asset badge exposes a compact batch checkbox when available', () => {
  assert.match(source, /badge\.batch\?\.available/);
  assert.match(source, /type="checkbox"/);
  assert.match(source, /batch-toggle/);
});

test('asset badge exposes the close tab mode selector', () => {
  assert.match(source, /badge\.closeTab\?\.available/);
  assert.match(source, /Close tab mode/);
  assert.match(source, /close-mode-change/);
  assert.match(source, /Close tab:/);
  assert.match(source, /After queue/);
  assert.match(source, /On complete/);
});

test('asset badge renders actionable failure copy without a failed zero-percent state', () => {
  assert.match(source, /badge\.failureMessage/);
  assert.doesNotMatch(source, /FAILED.*0%/i);
});

test('asset badge listens for local shortcut reactions on non-control surfaces', () => {
  assert.match(source, /reactionFromBadgeShortcutEvent/);
  assert.match(source, /handleBadgeShortcut/);
  assert.match(source, /@click="handleBadgeShortcut"/);
  assert.match(source, /@mousedown="handleBadgeShortcut"/);
  assert.match(source, /@contextmenu="handleBadgeShortcut"/);
});

test('asset badge opens downloaded files through the Desktop command', () => {
  assert.match(source, /badge\.canOpenFile/);
  assert.match(source, /emit\('open-file'\)/);
  assert.doesNotMatch(source, /atlasFileUrl|atlas_url/);
});
