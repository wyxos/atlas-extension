import fs from 'node:fs';

// Tauri restores the unbundled executable after NSIS packaging. The installed
// copy contains its documented bundle-type marker instead. Permit exactly this
// one fixed-width replacement, not arbitrary differences or version-only checks.
export function matchesNsisExecutable(built, installed) {
  if (built.equals(installed)) return true;
  if (built.length !== installed.length) return false;
  const original = Buffer.from('__TAURI_BUNDLE_TYPE_VAR_UNK');
  const packaged = Buffer.from('__TAURI_BUNDLE_TYPE_VAR_NSS');
  const offset = built.indexOf(original);
  if (offset < 0 || built.indexOf(original, offset + 1) !== -1) return false;
  if (!installed.subarray(offset, offset + packaged.length).equals(packaged)) return false;
  const expected = Buffer.from(built);
  packaged.copy(expected, offset);
  return expected.equals(installed);
}

export function verifyInstalledExecutable(builtPath, installedPath) {
  if (!fs.existsSync(builtPath) || !fs.existsSync(installedPath)
    || !matchesNsisExecutable(fs.readFileSync(builtPath), fs.readFileSync(installedPath))) {
    throw new Error('Installed executable does not match this build.');
  }
}
