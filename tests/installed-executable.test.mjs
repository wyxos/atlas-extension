import assert from 'node:assert/strict';
import test from 'node:test';
import { matchesNsisExecutable } from '../scripts/smart-rebuild/installed-executable.mjs';

test('accepts byte-identical executables and the single Tauri NSIS marker patch', () => {
  const built = Buffer.from('MZ-header __TAURI_BUNDLE_TYPE_VAR_UNK application code');
  assert.equal(matchesNsisExecutable(built, Buffer.from(built)), true);
  assert.equal(matchesNsisExecutable(built, Buffer.from('MZ-header __TAURI_BUNDLE_TYPE_VAR_NSS application code')), true);
});

test('rejects unrelated changes, truncation, other bundle types and ambiguous markers', () => {
  const built = Buffer.from('MZ-header __TAURI_BUNDLE_TYPE_VAR_UNK application code');
  for (const text of [
    'MZ-header __TAURI_BUNDLE_TYPE_VAR_NSS application edit',
    'MZ-header __TAURI_BUNDLE_TYPE_VAR_NSS application',
    'MZ-header __TAURI_BUNDLE_TYPE_VAR_MSI application code',
  ]) assert.equal(matchesNsisExecutable(built, Buffer.from(text)), false);
  assert.equal(matchesNsisExecutable(Buffer.from('original'), Buffer.from('modified')), false);
  assert.equal(matchesNsisExecutable(Buffer.concat([built, built]), Buffer.concat([
    Buffer.from('MZ-header __TAURI_BUNDLE_TYPE_VAR_NSS application code'), built,
  ])), false);
});
