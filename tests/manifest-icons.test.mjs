import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

test('declares copied Atlas browser icons in the manifest', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

  assert.deepEqual(manifest.icons, {
    16: 'icons/favicon-16x16.png',
    32: 'icons/favicon-32x32.png',
    48: 'icons/favicon-48x48.png',
    128: 'icons/icon-128.png',
  });
  assert.deepEqual(manifest.action.default_icon, {
    16: 'icons/favicon-16x16.png',
    32: 'icons/favicon-32x32.png',
    48: 'icons/favicon-48x48.png',
  });

  for (const iconPath of Object.values(manifest.icons)) {
    assert.equal(fs.existsSync(path.join(root, iconPath)), true, `${iconPath} should exist`);
  }
});
