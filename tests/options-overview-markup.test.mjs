import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

const source = fs.readFileSync(
  path.resolve(import.meta.dirname, '../src/options/pages/Overview.vue'),
  'utf8',
);

test('options overview does not own close tab mode configuration', () => {
  assert.doesNotMatch(source, /closeTabModes/);
  assert.doesNotMatch(source, /atlas-close-site-domain/);
  assert.doesNotMatch(source, />\s*Close tab\s*</);
});
