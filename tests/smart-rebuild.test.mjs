import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assertReady, git, readVersion, snapshot, updateVersions } from '../scripts/smart-rebuild/repository.mjs';
import { runUpdate } from '../scripts/smart-rebuild/workflow.mjs';
import { createReviewInput } from '../scripts/smart-rebuild/review-input.mjs';

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-update-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const repos = ['extension', 'desktop'].map((kind) => {
    const root = path.join(directory, kind);
    fs.mkdirSync(path.join(root, 'src-tauri'), { recursive: true });
    fs.writeFileSync(path.join(root, '.gitignore'), 'dist/\n');
    fs.writeFileSync(path.join(root, 'source.txt'), 'original\n');
    for (const file of ['package.json', kind === 'extension' ? 'manifest.json' : 'src-tauri/tauri.conf.json']) {
      fs.writeFileSync(path.join(root, file), JSON.stringify({ name: `atlas-${kind}`, version: '0.1.0' }, null, 2));
    }
    fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ version: '0.1.0',
      packages: { '': { version: '0.1.0' }, dependency: { version: '9.1.0' } } }));
    if (kind === 'desktop') {
      fs.writeFileSync(path.join(root, 'src-tauri/Cargo.toml'), '[package]\nname = "atlas-desktop"\nversion = "0.1.0"\n');
      fs.writeFileSync(path.join(root, 'src-tauri/Cargo.lock'), 'version = 4\n\n[[package]]\nname = "another"\nversion = "8.0.0"\n\n[[package]]\nname = "atlas-desktop"\nversion = "0.1.0"\n');
    }
    git(root, ['init', '-b', 'main']);
    git(root, ['config', 'user.email', 'test@example.invalid']);
    git(root, ['config', 'user.name', 'Atlas Test']);
    git(root, ['config', 'core.autocrlf', 'false']);
    git(root, ['add', '-A']);
    git(root, ['commit', '-m', 'Initial version']);
    git(root, ['tag', 'v0.1.0']);
    return { kind, name: kind, root, artifact: path.join(root, 'dist', 'artifact.txt') };
  });
  const calls = { analyze: [], build: [], check: [] };
  const options = {
    repos, statePath: path.join(directory, 'state.json'), log: () => {},
    analyze: ({ repo }) => {
      calls.analyze.push(repo.kind);
      return { proceed: true, bump: 'minor', commitMessage: 'feat: improve capture', reason: 'Adds a capture feature.' };
    },
    check: (repo) => calls.check.push(repo.kind),
    build: (repo) => {
      calls.build.push(repo.kind);
      fs.mkdirSync(path.dirname(repo.artifact), { recursive: true });
      fs.writeFileSync(repo.artifact, `built ${readVersion(repo)}`);
    },
  };
  return { repos, options, calls };
}

test('repository validation accepts directory aliases and rejects nested directories', (t) => {
  const { repos } = fixture(t);
  const root = repos[0].root;
  const alias = path.join(path.dirname(root), 'extension-alias');
  fs.symlinkSync(root, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.doesNotThrow(() => assertReady(root));
  assert.doesNotThrow(() => assertReady(alias));
  assert.doesNotThrow(() => assertReady(fs.realpathSync.native(root)));
  assert.throws(() => assertReady(path.join(root, 'src-tauri')), /Expected an independent repository/);
});

test('dirty release commits tracked/untracked/deleted files, then skips both; AE changes do not rebuild AD', async (t) => {
  const { repos, options, calls } = fixture(t);
  fs.unlinkSync(path.join(repos[0].root, 'source.txt'));
  fs.writeFileSync(path.join(repos[0].root, 'new.txt'), 'feature');
  await runUpdate(options);
  for (const repo of repos) {
    assert.equal(readVersion(repo), '0.2.0');
    assert.equal(git(repo.root, ['status', '--porcelain']), '');
    assert.match(git(repo.root, ['log', '-1', '--format=%B']), /feat: improve capture/);
  }
  assert.deepEqual((await runUpdate(options)).map((item) => item.action), ['skip', 'skip']);
  fs.writeFileSync(path.join(repos[0].root, 'new.txt'), 'another feature');
  await runUpdate(options);
  assert.deepEqual(calls.build, ['extension', 'desktop', 'extension']);
  assert.equal(readVersion(repos[0]), '0.3.0');
  assert.equal(readVersion(repos[1]), '0.2.0');
});

test('failed installation retries same committed version and skips the completed extension', async (t) => {
  const { repos, options, calls } = fixture(t);
  const build = options.build;
  options.build = (repo) => {
    if (repo.kind === 'desktop') throw new Error('installer failed');
    return build(repo);
  };
  await assert.rejects(runUpdate(options), /installer failed/);
  const head = git(repos[1].root, ['rev-parse', 'HEAD']);
  options.build = build;
  const results = await runUpdate(options);
  assert.deepEqual(results.map((item) => item.action), ['skip', 'retry']);
  assert.equal(readVersion(repos[1]), '0.2.0');
  assert.equal(git(repos[1].root, ['rev-parse', 'HEAD']), head);
  assert.deepEqual(calls.analyze, ['extension', 'desktop']);
});

test('validation failure keeps version preparation and retries without a second Codex bump', async (t) => {
  const { repos, options, calls } = fixture(t);
  options.check = () => { throw new Error('validation failed'); };
  await assert.rejects(runUpdate(options), /validation failed/);
  assert.equal(readVersion(repos[0]), '0.2.0');
  options.check = () => {};
  await runUpdate(options);
  assert.equal(readVersion(repos[0]), '0.2.0');
  assert.deepEqual(calls.analyze, ['extension', 'desktop']);
});

test('interruption after commit recovers preparation without bumping again', async (t) => {
  const { repos, options, calls } = fixture(t);
  options.check = () => { throw new Error('pause'); };
  await assert.rejects(runUpdate(options), /pause/);
  git(repos[0].root, ['add', '-A']);
  git(repos[0].root, ['commit', '-m', 'Prepared release']);
  const head = git(repos[0].root, ['rev-parse', 'HEAD']);
  options.check = () => {};
  await runUpdate(options);
  assert.equal(git(repos[0].root, ['rev-parse', 'HEAD']), head);
  assert.equal(readVersion(repos[0]), '0.2.0');
  assert.deepEqual(calls.analyze, ['extension', 'desktop']);
});

test('missing or altered artifacts restore the same version without another commit', async (t) => {
  const { repos, options, calls } = fixture(t);
  await runUpdate(options);
  fs.unlinkSync(repos[0].artifact);
  fs.writeFileSync(repos[1].artifact, 'tampered');
  const heads = repos.map((repo) => git(repo.root, ['rev-parse', 'HEAD']));
  assert.deepEqual((await runUpdate(options)).map((item) => item.action), ['restore', 'restore']);
  assert.deepEqual(repos.map((repo) => git(repo.root, ['rev-parse', 'HEAD'])), heads);
  assert.deepEqual(calls.analyze, ['extension', 'desktop']);
});

test('concurrent source edits during Codex review abort before versioning or committing', async (t) => {
  const { repos, options } = fixture(t);
  const head = git(repos[0].root, ['rev-parse', 'HEAD']);
  const analyze = options.analyze;
  options.analyze = (context) => {
    fs.writeFileSync(path.join(context.repo.root, 'source.txt'), 'concurrent edit');
    return analyze(context);
  };
  await assert.rejects(runUpdate(options), /source or staging changed/);
  assert.equal(readVersion(repos[0]), '0.1.0');
  assert.equal(git(repos[0].root, ['rev-parse', 'HEAD']), head);
});

test('dry run preserves staging, versions, commits and state and does not call Codex/build/check', async (t) => {
  const { repos, options, calls } = fixture(t);
  fs.writeFileSync(path.join(repos[0].root, 'source.txt'), 'staged');
  git(repos[0].root, ['add', 'source.txt']);
  fs.writeFileSync(path.join(repos[0].root, 'source.txt'), 'unstaged');
  const before = snapshot(repos[0].root);
  await runUpdate({ ...options, dryRun: true });
  assert.deepEqual(snapshot(repos[0].root), before);
  assert.deepEqual(calls, { analyze: [], build: [], check: [] });
  assert.equal(fs.existsSync(options.statePath), false);
});

test('synchronizes Desktop version files without changing dependency versions', (t) => {
  const { repos } = fixture(t);
  updateVersions(repos[1], '1.2.3');
  for (const file of ['package.json', 'src-tauri/tauri.conf.json', 'package-lock.json']) {
    assert.equal(JSON.parse(fs.readFileSync(path.join(repos[1].root, file))).version, '1.2.3');
  }
  const lock = JSON.parse(fs.readFileSync(path.join(repos[1].root, 'package-lock.json')));
  assert.equal(lock.packages[''].version, '1.2.3');
  assert.equal(lock.packages.dependency.version, '9.1.0');
  const cargoLock = fs.readFileSync(path.join(repos[1].root, 'src-tauri/Cargo.lock'), 'utf8');
  assert.match(cargoLock, /name = "another"\nversion = "8.0.0"/);
  assert.match(cargoLock, /name = "atlas-desktop"\nversion = "1.2.3"/);
});

test('Codex refusal and Git conflicts stop without committing', async (t) => {
  const { repos, options } = fixture(t);
  options.analyze = () => ({ proceed: false, reason: 'Cannot assess.' });
  await assert.rejects(runUpdate(options), /Codex did not approve/);
  assert.equal(readVersion(repos[0]), '0.1.0');
  fs.writeFileSync(path.join(repos[1].root, '.git', 'MERGE_HEAD'), git(repos[1].root, ['rev-parse', 'HEAD']));
  await assert.rejects(runUpdate(options), /active Git operation/);
});

test('Codex input contains immutable working edits, untracked additions, deletions and committed history', (t) => {
  const { repos } = fixture(t);
  const repo = repos[0];
  fs.writeFileSync(path.join(repo.root, 'history.txt'), 'historical feature');
  git(repo.root, ['add', '-A']);
  git(repo.root, ['commit', '-m', 'feat: committed feature']);
  fs.unlinkSync(path.join(repo.root, 'source.txt'));
  fs.writeFileSync(path.join(repo.root, 'new.txt'), 'new unstaged feature');
  const initial = snapshot(repo.root);
  fs.writeFileSync(path.join(repo.root, 'new.txt'), 'a later edit must not enter captured evidence');
  const input = createReviewInput({ repo, initial, currentVersion: '0.1.0', base: 'v0.1.0' });
  assert.match(input, /Do not invoke any tools/);
  assert.match(input, /feat: committed feature/);
  assert.match(input, /historical feature/);
  assert.match(input, /new unstaged feature/);
  assert.match(input, /deleted file mode/);
  assert.doesNotMatch(input, /a later edit must not enter/);
});
