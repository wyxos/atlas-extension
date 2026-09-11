import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { git } from '../scripts/smart-rebuild/repository.mjs';
import { command, runIsolatedUpdate, publishExtension, recoverPublication, removeWorkspace } from '../scripts/smart-rebuild/isolated.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-isolation-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repos = ['extension', 'desktop'].map((kind) => {
    const directory = path.join(root, kind);
    fs.mkdirSync(directory);
    git(directory, ['init', '-b', 'main']);
    git(directory, ['config', 'user.email', 'test@example.invalid']);
    git(directory, ['config', 'user.name', 'Test']);
    fs.writeFileSync(path.join(directory, 'package-lock.json'), '{}');
    fs.mkdirSync(path.join(directory, 'src-tauri'));
    fs.writeFileSync(path.join(directory, 'src-tauri', 'placeholder'), 'tracked');
    fs.writeFileSync(path.join(directory, 'source.txt'), 'committed');
    git(directory, ['add', '.']);
    git(directory, ['commit', '-m', 'initial']);
    fs.writeFileSync(path.join(directory, 'source.txt'), 'staged');
    git(directory, ['add', '.']);
    fs.writeFileSync(path.join(directory, 'source.txt'), 'unfinished');
    git(directory, ['switch', '-c', 'ongoing']);
    return { kind, name: kind, root: directory, artifact: path.join(root, 'outputs', kind) };
  });
  const logs = [];
  return { root, repos, logs, stateDirectory: path.join(root, 'state'), log: (line) => logs.push(line),
    scopeFactory: async () => ({ environment: { CARGO_TARGET_DIR: path.join(root, 'state', 'cache', 'desktop-target') }, close: async () => {} }),
    execute: (name, args, options) => name === 'git' ? command(name, args, options) : Promise.resolve(),
    buildOverride: async (repo, plans) => {
      assert.equal(fs.readFileSync(path.join(repo.snapshot, 'source.txt'), 'utf8'), 'committed');
      assert.equal(fs.readFileSync(path.join(plans[0].snapshot, 'source.txt'), 'utf8'), 'committed');
      if (repo.kind === 'extension') {
        const output = path.join(repo.snapshot, 'dist', 'atlas-extension-stable-validation');
        fs.mkdirSync(output, { recursive: true });
        fs.writeFileSync(path.join(output, 'manifest.json'), '{"version":"1.0.0"}');
      } else {
        fs.mkdirSync(path.dirname(repo.artifact), { recursive: true });
        fs.writeFileSync(repo.artifact, 'installer result');
      }
    } };
}

test('builds captured main, preserves live index/branch/edits, skips success and restores missing output', async (t) => {
  const f = fixture(t);
  const before = f.repos.map((repo) => [git(repo.root, ['status', '--porcelain']), git(repo.root, ['write-tree']), git(repo.root, ['symbolic-ref', 'HEAD'])]);
  await runIsolatedUpdate(f);
  assert.deepEqual(f.repos.map((repo) => [git(repo.root, ['status', '--porcelain']), git(repo.root, ['write-tree']), git(repo.root, ['symbolic-ref', 'HEAD'])]), before);
  assert.deepEqual(fs.readdirSync(path.join(f.stateDirectory, 'workspaces')), []);
  assert.ok(fs.existsSync(path.join(f.stateDirectory, 'cache', 'desktop-target')));
  assert.ok(f.logs.some((line) => line.includes('Outstanding: reload')));
  assert.ok((await runIsolatedUpdate(f)).every((repo) => !repo.needed));
  fs.unlinkSync(f.repos[1].artifact);
  const restored = await runIsolatedUpdate(f);
  assert.equal(restored[0].needed, false);
  assert.equal(restored[1].needed, true);
});

test('failed build preserves output, cleans workspace and reports outstanding steps', async (t) => {
  const f = fixture(t);
  await assert.rejects(runIsolatedUpdate({ ...f, buildOverride: () => { throw new Error('fixture failure'); } }), /fixture failure/);
  assert.deepEqual(fs.readdirSync(path.join(f.stateDirectory, 'workspaces')), []);
  assert.equal(fs.existsSync(path.join(f.stateDirectory, 'isolated-state.json')), false);
  assert.ok(f.logs.some((line) => line.startsWith('Outstanding:')));
});

test('an Extension-only rebuild requests no Rust target or reservation', async (t) => {
  const f = fixture(t);
  await runIsolatedUpdate(f);
  fs.rmSync(f.repos[0].artifact, { recursive: true });
  let options;
  await runIsolatedUpdate({ ...f, scopeFactory: async (...args) => {
    options = args[2];
    return { environment: {}, close: async () => {} };
  } });
  assert.deepEqual(options, { rust: false });
});

test('dry run does not create state or workspaces', async (t) => {
  const f = fixture(t);
  await runIsolatedUpdate({ ...f, dryRun: true });
  assert.equal(fs.existsSync(f.stateDirectory), false);
});

test('publication recovers interrupted rename and rejects incomplete replacement', (t) => {
  const f = fixture(t);
  const destination = path.join(f.root, 'published');
  fs.mkdirSync(`${destination}.atlas-previous`);
  fs.writeFileSync(path.join(`${destination}.atlas-previous`, 'manifest.json'), 'old');
  recoverPublication(destination);
  assert.equal(fs.readFileSync(path.join(destination, 'manifest.json'), 'utf8'), 'old');
  assert.throws(() => publishExtension(f.repos[0].root, destination), /missing its manifest/);
  assert.equal(fs.readFileSync(path.join(destination, 'manifest.json'), 'utf8'), 'old');
  assert.throws(() => removeWorkspace(f.root, f.repos[0].root), /Refusing cleanup/);
});

test('moving both main refs during the build does not change either captured revision', async (t) => {
  const f = fixture(t);
  let moved = false;
  const original = f.execute;
  const plans = await runIsolatedUpdate({ ...f, execute: async (...args) => {
    if (!moved) {
      moved = true;
      for (const repo of f.repos) {
        git(repo.root, ['add', '.']);
        git(repo.root, ['commit', '-m', 'ongoing work committed later']);
        git(repo.root, ['update-ref', 'refs/heads/main', 'HEAD']);
      }
    }
    return original(...args);
  } });
  for (const repo of plans) assert.notEqual(git(repo.root, ['rev-parse', 'main']), repo.head);
});

test('command keeps raw output in the log and emits only recognized status', async (t) => {
  const f = fixture(t);
  const logFile = path.join(f.root, 'command.log');
  const statuses = [];
  await command(process.execPath, ['-e', 'console.log("compiler chatter"); console.log("Installing and reopening Atlas silently...")'],
    { cwd: f.root, env: process.env, logFile, status: (value) => statuses.push(value) });
  assert.deepEqual(statuses, ['Desktop: installing and reopening']);
  assert.match(fs.readFileSync(logFile, 'utf8'), /compiler chatter/);
});

test('a main revision without a lockfile uses npm install only inside its snapshot', async (t) => {
  const f = fixture(t);
  const repo = f.repos[0];
  git(repo.root, ['rm', 'package-lock.json']);
  git(repo.root, ['commit', '-m', 'omit lockfile']);
  git(repo.root, ['update-ref', 'refs/heads/main', 'HEAD']);
  let usedFallback = false;
  await assert.rejects(runIsolatedUpdate({ ...f, execute: async (name, args, options) => {
    if (name !== 'git') {
      assert.match(args.join(' '), /npm.cmd install --no-audit/);
      assert.notEqual(options.cwd, repo.root);
      usedFallback = true;
      throw new Error('fixture stop after install selection');
    }
    return command(name, args, options);
  } }), /fixture stop/);
  assert.equal(usedFallback, true);
  assert.equal(fs.existsSync(path.join(repo.root, 'package-lock.json')), false);
});

test('command logs are bounded and declare truncation while status still arrives', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-log-test-'));
  t.after(() => { assert.equal(path.dirname(root), fs.realpathSync(os.tmpdir())); fs.rmSync(root, {recursive:true, force:true}); });
  const logFile = path.join(root, 'command.log'), statuses = [];
  await command(process.execPath, ['-e', 'process.stdout.write("x".repeat(17*1024**2)); console.log("Installing and reopening Atlas silently...")'],
    {cwd:root,env:process.env,logFile,status:value=>statuses.push(value)});
  assert.ok(fs.statSync(logFile).size <= 16*1024**2);
  assert.match(fs.readFileSync(logFile,'utf8'), /Atlas log truncated/);
  assert.deepEqual(statuses, ['Desktop: installing and reopening']);
});
