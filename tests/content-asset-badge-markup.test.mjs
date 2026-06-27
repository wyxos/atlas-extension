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
});
