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
