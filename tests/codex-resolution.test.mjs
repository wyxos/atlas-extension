import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { resolveCodex } from '../scripts/smart-rebuild/codex-review.mjs';

test('Codex discovery refreshes the Store package between review and repair', {
  skip: process.platform !== 'win32',
}, (t) => {
  const locations = ['C:\\fixture\\Codex_old', 'C:\\fixture\\Codex_current'];
  let queries = 0;
  t.mock.method(childProcess, 'spawnSync', () => ({ status: 0, stdout: locations[queries++] }));
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const options = { env: {}, exists: () => true };
  assert.equal(resolveCodex(options), path.join(locations[0], 'app', 'resources', 'codex.exe'));
  assert.equal(resolveCodex(options), path.join(locations[1], 'app', 'resources', 'codex.exe'));
  assert.equal(queries, 2);
});

test('shortcut launcher lets a later repair discover the updated Store package', {
  skip: process.platform !== 'win32', timeout: 30000,
}, (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-codex-resolution-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const previous = path.join(directory, 'Codex_old');
  const current = path.join(directory, 'Codex_current');
  for (const app of [previous, current]) {
    fs.mkdirSync(path.join(app, 'app', 'resources'), { recursive: true });
    fs.writeFileSync(path.join(app, 'app', 'resources', 'codex.exe'), 'synthetic CLI');
  }
  const probe = path.join(directory, 'probe.mjs');
  const resolverUrl = pathToFileURL(path.resolve(import.meta.dirname, '../scripts/smart-rebuild/codex-review.mjs')).href;
  fs.writeFileSync(probe, `import fs from 'node:fs';
import path from 'node:path';
import { resolveCodex } from ${JSON.stringify(resolverUrl)};
// A Store update removes the original package during the long build checks.
fs.unlinkSync(path.join(process.env.ATLAS_FIXTURE_PREVIOUS, 'app', 'resources', 'codex.exe'));
const actual = resolveCodex({ locate: () => process.env.ATLAS_FIXTURE_CURRENT });
const expected = path.join(process.env.ATLAS_FIXTURE_CURRENT, 'app', 'resources', 'codex.exe');
console.log(JSON.stringify({ actual, expected, exists: fs.existsSync(actual) }));
process.exitCode = actual === expected && fs.existsSync(actual) ? 0 : 9;
`);
  const target = path.join(directory, 'target.ps1');
  fs.writeFileSync(target, '& $env:ATLAS_FIXTURE_NODE $env:ATLAS_FIXTURE_PROBE\nexit $LASTEXITCODE\n');
  const bootstrap = path.join(directory, 'bootstrap.ps1');
  fs.writeFileSync(bootstrap, `function Get-AppxPackage {
    [pscustomobject]@{ Version = [version]'26.1013.3656.0'; InstallLocation = $env:ATLAS_FIXTURE_PREVIOUS }
}
& $env:ATLAS_FIXTURE_WRAPPER -ScriptPath $env:ATLAS_FIXTURE_TARGET
exit $LASTEXITCODE
`);
  const env = { ...process.env, ATLAS_FIXTURE_PREVIOUS: previous, ATLAS_FIXTURE_CURRENT: current,
    ATLAS_FIXTURE_NODE: process.execPath, ATLAS_FIXTURE_PROBE: probe, ATLAS_FIXTURE_TARGET: target,
    ATLAS_FIXTURE_WRAPPER: path.resolve(import.meta.dirname, '../scripts/run-desktop-script.ps1') };
  delete env.CODEX_EXECUTABLE;
  const result = childProcess.spawnSync('pwsh.exe', ['-NoProfile', '-File', bootstrap], {
    env, input: '\n', encoding: 'utf8', windowsHide: true, timeout: 25000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.ok(result.stdout.includes('"exists":true'));
});

test('Codex discovers the native CLI under a custom global npm prefix only as fallback', () => {
  const npmRoot = path.join('C:', 'custom-npm', 'node_modules');
  const native = path.join(npmRoot, '@openai', 'codex', 'node_modules', '@openai',
    'codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe');
  let npmQueries = 0;
  const locateNpmRoot = () => { npmQueries++; return npmRoot; };
  const exists = file => file === native;
  assert.equal(resolveCodex({ env: {}, locate: () => null, locateNpmRoot, exists }), native);
  assert.equal(npmQueries, 1);
  const bundled = path.join('C:', 'Store', 'app', 'resources', 'codex.exe');
  assert.equal(resolveCodex({ env: {}, locate: () => path.join('C:', 'Store'),
    locateNpmRoot, exists: file => file === bundled }), bundled);
  assert.equal(npmQueries, 1, 'the current Store package must not query npm');
  const appdata = path.join('C:', 'Roaming');
  const standard = path.join(appdata, 'npm', 'node_modules', '@openai', 'codex', 'node_modules', '@openai',
    'codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe');
  assert.equal(resolveCodex({ env: { APPDATA: appdata }, locate: () => null,
    locateNpmRoot, exists: file => file === standard }), standard);
  assert.equal(npmQueries, 1, 'the standard native npm binary must not query npm');
  assert.equal(resolveCodex({ env: { CODEX_EXECUTABLE: 'user-codex' },
    locate: () => assert.fail('Explicit overrides do not need discovery'), locateNpmRoot, exists }), 'user-codex');
  assert.equal(npmQueries, 1);
});
