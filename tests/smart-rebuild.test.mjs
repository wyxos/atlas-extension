import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assertReady, git, readVersion, snapshot, updateVersions } from '../scripts/smart-rebuild/repository.mjs';
import { runUpdate } from '../scripts/smart-rebuild/workflow.mjs';
import { changeUnits, plannedCommits } from '../scripts/smart-rebuild/commit-plan.mjs';
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
    analyze: ({ repo, initial }) => {
      calls.analyze.push(repo.kind);
      return { proceed: true, bump: 'minor', commits: initial.status ? [{ message: 'feat: improve capture', reason: 'Capture feature', changes: changeUnits(repo.root, initial.head, initial.tree).flatMap(file => file.units.map(unit => unit.id)) }] : [], reason: 'Adds a capture feature.' };
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

test('semantic groups split shared-file hunks and keep release versioning separate', async (t) => {
  const { repos, options } = fixture(t);
  const repo = repos[0];
  fs.writeFileSync(path.join(repo.root, 'shared.txt'), 'one\nkeep\nkeep\nkeep\ntwo\n');
  git(repo.root, ['add', '-A']);
  git(repo.root, ['commit', '-m', 'Shared fixture']);
  const base = git(repo.root, ['rev-parse', 'HEAD']);
  fs.writeFileSync(path.join(repo.root, 'shared.txt'), 'first feature\nkeep\nkeep\nkeep\nsecond fix\n');
  const analyze = options.analyze;
  options.analyze = (context) => {
    if (context.repo !== repo) return analyze(context);
    const units = changeUnits(repo.root, context.initial.head, context.initial.tree).flatMap(file => file.units);
    assert.equal(units.length, 2);
    return { proceed: true, bump: 'minor', reason: 'Two tasks', commits: [
      { message: 'feat: first task', reason: 'Archived task', changes: [units[0].id] },
      { message: 'fix: second task', reason: 'Active task', changes: [units[1].id] },
    ] };
  };
  await runUpdate(options);
  assert.deepEqual(git(repo.root, ['log', '--reverse', '--format=%s', `${base}..HEAD`]).split('\n'),
    ['feat: first task', 'fix: second task', 'chore(release): prepare extension 0.2.0']);
  assert.equal(git(repo.root, ['show', 'HEAD~2:shared.txt']), 'first feature\nkeep\nkeep\nkeep\ntwo');
  assert.equal(git(repo.root, ['diff', '--name-only', 'HEAD~1', 'HEAD']).includes('shared.txt'), false);
});

test('invalid semantic plans fail before versioning and preserve staging', async (t) => {
  const { repos, options } = fixture(t);
  const repo = repos[0];
  fs.writeFileSync(path.join(repo.root, 'source.txt'), 'change\n');
  git(repo.root, ['add', 'source.txt']);
  const initial = snapshot(repo.root);
  const files = changeUnits(repo.root, initial.head, initial.tree);
  for (const changes of [[], ['unknown'], ['change-1', 'change-1']]) {
    options.analyze = () => ({ proceed: true, bump: 'patch', reason: 'Fix',
      commits: changes.length ? [{ message: 'fix: change', reason: 'Task', changes }] : [] });
    await assert.rejects(runUpdate(options), /cover every|Unknown or duplicate/);
    assert.deepEqual(snapshot(repo.root), initial);
  }
  assert.equal(readVersion(repo), '0.1.0');
  assert.equal(fs.existsSync(options.statePath), false);
  assert.throws(() => plannedCommits(repo.root, initial.head, files, null), /Missing semantic/);
});

test('binary additions and text without a final newline survive semantic commits exactly', (t) => {
  const { repos } = fixture(t);
  const repo = repos[0];
  fs.writeFileSync(path.join(repo.root, 'binary.dat'), Buffer.from([0, 255, 10, 0, 13]));
  fs.writeFileSync(path.join(repo.root, 'source.txt'), 'replacement with trailing spaces  ');
  const initial = snapshot(repo.root);
  const files = changeUnits(repo.root, initial.head, initial.tree);
  const groups = files.map((file, index) => ({ message: `fix: part ${index}`, reason: 'Separate task',
    changes: file.units.map((unit) => unit.id) }));
  assert.equal(plannedCommits(repo.root, initial.head, files, groups).at(-1).tree, initial.tree);
  assert.deepEqual(snapshot(repo.root), initial);
});

test('concurrent edits during version replacement cannot enter the release commit', async (t) => {
  const { repos, options } = fixture(t);
  const repo = repos[0];
  const head = git(repo.root, ['rev-parse', 'HEAD']);
  const rename = fs.renameSync;
  t.mock.method(fs, 'renameSync', (source, target) => {
    const result = rename(source, target);
    if (target === path.join(repo.root, 'manifest.json')) {
      fs.writeFileSync(path.join(repo.root, 'source.txt'), 'Concurrent edit');
    }
    return result;
  });
  await assert.rejects(runUpdate(options), /Source changed during version preparation/);
  assert.equal(git(repo.root, ['rev-parse', 'HEAD']), head);
  assert.equal(fs.readFileSync(path.join(repo.root, 'source.txt'), 'utf8'), 'Concurrent edit');
});

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
    assert.match(git(repo.root, ['log', '-1', '--format=%B']), /chore\(release\): prepare/);
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

test('failed version replacement restores every original byte and removes staging files', (t) => {
  const { repos } = fixture(t);
  const repo = repos[1];
  const files = ['package.json', 'package-lock.json', 'src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock'];
  const originals = files.map((file) => fs.readFileSync(path.join(repo.root, file)));
  const rename = fs.renameSync;
  t.mock.method(fs, 'renameSync', (source, target) => {
    if (target === path.join(repo.root, 'src-tauri/Cargo.toml')) {
      throw Object.assign(new Error('Injected replacement failure'), { code: 'EIO' });
    }
    return rename(source, target);
  });
  assert.throws(() => updateVersions(repo, '1.2.3'), /Cannot replace .*Cargo.toml \(EIO\)/);
  files.forEach((file, index) => assert.deepEqual(fs.readFileSync(path.join(repo.root, file)), originals[index]));
  for (const directory of [repo.root, path.join(repo.root, 'src-tauri')]) {
    assert.equal(fs.readdirSync(directory).some((file) => file.endsWith('.tmp')), false);
  }
});

test('Windows mapped manifest reproduces UNKNOWN and version update waits for its release', {
  skip: process.platform !== 'win32', timeout: 20000,
}, async (t) => {
  const { repos } = fixture(t);
  const repo = repos[1];
  const target = path.join(repo.root, 'src-tauri/Cargo.toml');
  const script = `
    $ErrorActionPreference = 'Stop'
    $stream = [IO.File]::Open($env:ATLAS_TEST_MANIFEST, 'Open', 'Read', ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
    $map = [IO.MemoryMappedFiles.MemoryMappedFile]::CreateFromFile($stream, ('AtlasTest' + [guid]::NewGuid()), 0, 'Read', 'None', $true)
    $view = $map.CreateViewAccessor(0, 0, 'Read')
    try { Write-Output 'mapped'; Start-Sleep -Milliseconds 1200 }
    finally { $view.Dispose(); $map.Dispose(); $stream.Dispose() }
  `;
  const child = spawn('pwsh.exe', ['-NoProfile', '-Command', script], {
    windowsHide: true, env: { ...process.env, ATLAS_TEST_MANIFEST: target },
  });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => reject(new Error(`Mapping helper exited before readiness: ${code}`)));
    child.stdout.once('data', (data) => data.toString().includes('mapped') ? resolve() : reject(new Error('Mapping helper was not ready')));
  });
  assert.throws(() => fs.writeFileSync(target, 'must not truncate'), { code: 'UNKNOWN' });
  updateVersions(repo, '1.2.3');
  assert.match(fs.readFileSync(target, 'utf8'), /version = "1.2.3"/);
  assert.equal(readVersion(repo), '1.2.3');
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

function reviewEvidence(input) {
  return JSON.parse(input.split('BEGIN GIT EVIDENCE (JSON DATA)\n')[1].split('\nEND GIT EVIDENCE')[0]);
}

test('large task history stays bounded for clean and dirty releases without losing working evidence', (t) => {
  const { repos } = fixture(t);
  const repo = repos[0];
  const taskContext = { tasks: Array.from({ length: 80 }, (_, id) => ({ id,
    title: 'Task', request: '\\"\n'.repeat(2000), finalAnswer: 'Verified outcome' })) };
  for (const dirty of [false, true]) {
    if (dirty) fs.writeFileSync(path.join(repo.root, 'new.txt'), 'Complete working evidence\n');
    const initial = snapshot(repo.root);
    const evidence = reviewEvidence(createReviewInput({ repo, initial, base: 'v0.1.0', currentVersion: '0.1.0', taskContext }));
    assert.ok(JSON.stringify(evidence, null, 2).length <= 750_000);
    assert.ok(evidence.taskContext.tasks.length > 0 && evidence.taskContext.tasks.length < 80);
    assert.match(evidence.taskContext.coverage, /omitted/);
    assert.deepEqual(evidence.changeUnits, changeUnits(repo.root, initial.head, initial.tree));
    if (dirty) assert.match(evidence.workingChanges.patch, /Complete working evidence/);
    else assert.equal(evidence.workingChanges.patch, '');
  }
  assert.equal(taskContext.tasks.length, 80);
});

test('oversized working evidence still stops review instead of truncating changes', (t) => {
  const { repos } = fixture(t);
  const repo = repos[0];
  fs.writeFileSync(path.join(repo.root, 'large.txt'), 'x'.repeat(400_000));
  assert.throws(() => createReviewInput({ repo, initial: snapshot(repo.root), base: 'v0.1.0', currentVersion: '0.1.0' }),
    /Git evidence alone exceeds.*task history is excluded/);
});

test('working evidence takes priority over optional historical patch and task excerpts', (t) => {
  const { repos } = fixture(t);
  const repo = repos[0];
  fs.writeFileSync(path.join(repo.root, 'history.txt'), 'h'.repeat(190_000));
  git(repo.root, ['add', '-A']);
  git(repo.root, ['commit', '-m', 'feat: historical feature']);
  fs.writeFileSync(path.join(repo.root, 'working.txt'), 'w'.repeat(290_000));
  const initial = snapshot(repo.root);
  const evidence = reviewEvidence(createReviewInput({ repo, initial, base: 'v0.1.0', currentVersion: '0.1.0',
    taskContext: { tasks: [{ title: 't'.repeat(800_000) }] } }));
  assert.ok(JSON.stringify(evidence, null, 2).length <= 750_000);
  assert.equal(evidence.historicalChanges.patch, null);
  assert.match(evidence.historicalChanges.commits, /feat: historical feature/);
  assert.match(evidence.historicalChanges.coverage, /omitted/);
  assert.deepEqual(evidence.changeUnits, changeUnits(repo.root, initial.head, initial.tree));
  assert.ok(evidence.workingChanges.patch.includes('w'.repeat(290_000)));
  assert.match(evidence.taskContext.coverage, /1 omitted/);
});
