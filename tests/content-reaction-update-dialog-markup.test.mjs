import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

const source = fs.readFileSync(
  path.resolve(import.meta.dirname, '../src/content/ReactionUpdateDialog.vue'),
  'utf8',
);

test('reaction update dialog exposes the expected choices', () => {
  assert.match(source, /AlertDialog/);
  assert.match(source, /Update reaction only/);
  assert.match(source, /React \+ redownload/);
  assert.match(source, /Cancel/);
});

test('reaction update dialog lets explicit action clicks win over implicit close', () => {
  assert.match(source, /window\.setTimeout/);
  assert.match(source, /props\.request !== null/);
});
