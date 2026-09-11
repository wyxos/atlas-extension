import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { git } from '../scripts/smart-rebuild/repository.mjs';

function fixture(t, controller) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-preflight-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repos = ['atlas-extension', 'atlas-desktop'].map((name) => {
    const directory = path.join(root, name);
    fs.mkdirSync(directory);
    git(directory, ['init', '-b', 'main']);
    git(directory, ['config', 'user.email', 'test@example.invalid']);
    git(directory, ['config', 'user.name', 'Test']);
    fs.writeFileSync(path.join(directory, 'source.txt'), 'committed');
    git(directory, ['add', '.']);
    git(directory, ['commit', '-m', 'initial']);
    fs.writeFileSync(path.join(directory, 'source.txt'), 'staged');
    git(directory, ['add', '.']);
    fs.writeFileSync(path.join(directory, 'source.txt'), 'unfinished');
    return directory;
  });
  const scripts = path.join(repos[0], 'scripts');
  fs.mkdirSync(scripts);
  const sourceScripts = path.resolve(import.meta.dirname, '../scripts');
  fs.copyFileSync(path.join(sourceScripts, 'smart-rebuild.mjs'), path.join(scripts, 'smart-rebuild.mjs'));
  fs.cpSync(path.join(sourceScripts, 'smart-rebuild'), path.join(scripts, 'smart-rebuild'), { recursive: true });
  if (controller !== undefined) {
    const directory = path.join(repos[1], 'scripts', 'build-storage');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'update-scope.mjs'), controller);
  }
  const snapshot = () => repos.map((directory) => ({
    head: git(directory, ['rev-parse', 'HEAD']),
    index: git(directory, ['write-tree']),
    status: git(directory, ['status', '--porcelain']),
    source: fs.readFileSync(path.join(directory, 'source.txt'), 'utf8'),
  }));
  return { root, snapshot, run: (args) => spawnSync(process.execPath, [path.join(scripts, 'smart-rebuild.mjs'), ...args], {
    env: { ...process.env, LOCALAPPDATA: path.join(root, 'local'), NO_COLOR: '1' },
    encoding: 'utf8', windowsHide: true, timeout: 15_000,
  }) };
}

for (const [name, controller] of [
  ['missing', undefined],
  ['incompatible', 'export const version = 0;'],
  ['incomplete', 'import "./missing-dependency.mjs"; export function openUpdateScope() {}'],
]) {
  test(`${name} controller stops the updater before dirty-main prompts or state creation`, (t) => {
    const f = fixture(t, controller);
    const before = f.snapshot();
    for (const args of [[], ['--dry-run']]) {
      const result = f.run(args);
      assert.equal(result.error, undefined);
      assert.equal(result.status, 1);
      assert.match(result.stdout, /Finish integrating the managed build-storage changes/);
      assert.doesNotMatch(result.stdout, /uncommitted|Commit via Codex|ATLAS UPDATE/);
      assert.equal(fs.existsSync(path.join(f.root, 'local')), false);
      assert.deepEqual(f.snapshot(), before);
    }
  });
}

test('compatible controller allows dry-run inspection without opening a scope or changing main', (t) => {
  const f = fixture(t, 'export function openUpdateScope() { throw new Error("Scope must not open during inspection"); }');
  const before = f.snapshot();
  const result = f.run(['--dry-run']);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Inspection complete/);
  assert.equal(fs.existsSync(path.join(f.root, 'local')), false);
  assert.deepEqual(f.snapshot(), before);
});
