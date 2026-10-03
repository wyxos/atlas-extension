import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { git, snapshot } from '../scripts/smart-rebuild/repository.mjs';
import { publishRepair, recoverRepairPublications } from '../scripts/smart-rebuild/repair-publication.mjs';
import { prepareVersions } from '../scripts/smart-rebuild/version-review.mjs';

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-repair-publication-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'source');
  const temporary = path.join(directory, 'snapshot');
  fs.mkdirSync(root);
  fs.mkdirSync(temporary);
  git(root, ['init', '-b', 'main']);
  git(root, ['config', 'user.name', 'Source Identity']);
  git(root, ['config', 'user.email', 'source@example.invalid']);
  git(root, ['config', 'core.autocrlf', 'false']);
  fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules/\npackage-lock.json\n');
  fs.writeFileSync(path.join(root, 'manifest.json'), '{"version":"1.2.3"}\n');
  fs.writeFileSync(path.join(root, 'package.json'), '{"version":"1.2.3"}\n');
  fs.writeFileSync(path.join(root, 'source.txt'), 'initial\n');
  fs.writeFileSync(path.join(root, 'obsolete.txt'), 'remove me\n');
  git(root, ['add', '.']);
  git(root, ['update-index', '--chmod=+x', 'source.txt']);
  git(root, ['commit', '-m', 'initial version']);
  fs.writeFileSync(path.join(root, 'source.txt'), 'broken\n');
  git(root, ['commit', '-am', 'broken source']);
  const head = git(root, ['rev-parse', 'HEAD']);
  git(temporary, ['init']);
  git(temporary, ['config', 'core.autocrlf', 'false']);
  git(temporary, ['fetch', '--no-tags', '--depth=1', root, head]);
  git(temporary, ['checkout', '--detach', 'FETCH_HEAD']);
  fs.writeFileSync(path.join(temporary, 'source.txt'), 'repaired\n');
  fs.writeFileSync(path.join(temporary, 'new.txt'), 'new file\n');
  fs.rmSync(path.join(temporary, 'obsolete.txt'));
  fs.writeFileSync(path.join(temporary, 'package-lock.json'), 'generated ignored dependency lock');
  const stateDirectory = path.join(directory, 'state');
  const logFile = path.join(directory, 'artifacts', 'updater.log');
  return { directory, repo: { kind: 'extension', name: 'Extension', root, snapshot: temporary, head },
    stateDirectory, logFile, expectedTree: snapshot(temporary).tree };
}

function journal(f) {
  return JSON.parse(fs.readFileSync(path.join(f.stateDirectory, 'repair-publication-state.json'), 'utf8'));
}

function bundles(f) {
  return fs.readdirSync(path.dirname(f.logFile)).filter((file) => file.endsWith('.bundle'))
    .map((file) => path.join(path.dirname(f.logFile), file));
}

test('publishes the exact verified repair with source identity, additions and deletions', (t) => {
  const f = fixture(t);
  const result = publishRepair(f);
  assert.equal(result.tree, f.expectedTree);
  assert.equal(git(f.repo.root, ['rev-parse', 'main']), result.head);
  assert.equal(git(f.repo.snapshot, ['rev-parse', 'HEAD']), result.head);
  assert.equal(git(f.repo.snapshot, ['status', '--porcelain']), '');
  assert.equal(git(f.repo.root, ['rev-parse', `${result.head}^{tree}`]), f.expectedTree);
  assert.equal(git(f.repo.root, ['show', '-s', '--format=%P', result.head]), f.repo.head);
  assert.equal(git(f.repo.root, ['show', '-s', '--format=%an <%ae>|%cn <%ce>', result.head]),
    'Source Identity <source@example.invalid>|Source Identity <source@example.invalid>');
  assert.equal(git(f.repo.root, ['show', '-s', '--format=%s', result.head]), 'fix: repair updater validation failure');
  assert.match(git(f.repo.root, ['ls-tree', result.head, '--', 'source.txt']), /^100755 /);
  assert.equal(git(f.repo.root, ['status', '--porcelain']), '');
  assert.equal(fs.readFileSync(path.join(f.repo.root, 'source.txt'), 'utf8'), 'repaired\n');
  assert.equal(fs.readFileSync(path.join(f.repo.root, 'new.txt'), 'utf8'), 'new file\n');
  assert.equal(fs.existsSync(path.join(f.repo.root, 'obsolete.txt')), false);
  assert.equal(git(f.repo.root, ['ls-tree', result.head, '--', 'package-lock.json']), '');
  assert.deepEqual(journal(f).repos, {});
  assert.equal(bundles(f).length, 1);
});

test('refuses dirty main while preserving staged and unstaged changes and a durable repair', (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.repo.root, 'source.txt'), 'user staged\n');
  git(f.repo.root, ['add', 'source.txt']);
  fs.writeFileSync(path.join(f.repo.root, 'source.txt'), 'user unfinished\n');
  fs.writeFileSync(path.join(f.repo.root, 'untracked.txt'), 'user new\n');
  const before = snapshot(f.repo.root);
  assert.throws(() => publishRepair(f), /uncommitted changes.*Recovery bundle/);
  assert.deepEqual(snapshot(f.repo.root), before);
  assert.equal(git(f.repo.root, ['rev-parse', 'main']), f.repo.head);
  assert.equal(fs.existsSync(path.join(f.stateDirectory, 'version-state.json')), false);
  const [bundle] = bundles(f);
  fs.rmSync(f.repo.snapshot, { recursive: true, force: true });
  git(f.repo.root, ['bundle', 'verify', bundle]);
  const recovered = path.join(f.directory, 'recovered');
  fs.mkdirSync(recovered);
  git(recovered, ['init']);
  git(recovered, ['fetch', f.repo.root, f.repo.head]);
  const repairRef = git(f.repo.root, ['bundle', 'list-heads', bundle]).split(' ')[1];
  git(recovered, ['fetch', bundle, repairRef]);
  assert.equal(git(recovered, ['show', 'FETCH_HEAD:source.txt']), 'repaired');
  assert.equal(git(recovered, ['ls-tree', 'FETCH_HEAD', '--', 'obsolete.txt']), '');
});

test('refuses changed main and keeps the newer commit plus recovery bundle', (t) => {
  const f = fixture(t);
  let moved;
  assert.throws(() => publishRepair({ ...f, checkpoint: (phase) => {
    if (phase !== 'saved') return;
    fs.writeFileSync(path.join(f.repo.root, 'source.txt'), 'newer main\n');
    git(f.repo.root, ['commit', '-am', 'new main']);
    moved = git(f.repo.root, ['rev-parse', 'HEAD']);
  } }), /Main changed.*Recovery bundle/);
  assert.equal(git(f.repo.root, ['rev-parse', 'HEAD']), moved);
  assert.equal(fs.readFileSync(path.join(f.repo.root, 'source.txt'), 'utf8'), 'newer main\n');
  assert.equal(fs.existsSync(path.join(f.stateDirectory, 'version-state.json')), false);
  assert.equal(bundles(f).length, 1);
});

test('advances unoccupied main without touching another branch, working files or staging', (t) => {
  const f = fixture(t);
  git(f.repo.root, ['switch', '-c', 'ongoing']);
  fs.writeFileSync(path.join(f.repo.root, 'source.txt'), 'staged elsewhere\n');
  git(f.repo.root, ['add', '.']);
  fs.writeFileSync(path.join(f.repo.root, 'source.txt'), 'unfinished elsewhere\n');
  const before = snapshot(f.repo.root);
  const branch = git(f.repo.root, ['symbolic-ref', 'HEAD']);
  const result = publishRepair(f);
  assert.deepEqual(snapshot(f.repo.root), before);
  assert.equal(git(f.repo.root, ['symbolic-ref', 'HEAD']), branch);
  assert.equal(git(f.repo.root, ['rev-parse', 'main']), result.head);
});

test('promotes the actual main worktree while preserving the launcher branch checkout', (t) => {
  const f = fixture(t);
  git(f.repo.root, ['switch', '-c', 'launcher']);
  const main = path.join(f.directory, 'main-worktree');
  git(f.repo.root, ['worktree', 'add', main, 'main']);
  fs.writeFileSync(path.join(f.repo.root, 'source.txt'), 'launcher unfinished\n');
  const before = snapshot(f.repo.root);
  const result = publishRepair(f);
  assert.deepEqual(snapshot(f.repo.root), before);
  assert.equal(git(main, ['rev-parse', 'HEAD']), result.head);
  assert.equal(git(main, ['status', '--porcelain']), '');
  assert.equal(fs.readFileSync(path.join(main, 'source.txt'), 'utf8'), 'repaired\n');
});

test('rejects post-validation source edits before creating or promoting a commit', (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.repo.snapshot, 'source.txt'), 'changed after check\n');
  assert.throws(() => publishRepair(f), /changed after validation/);
  assert.equal(git(f.repo.root, ['rev-parse', 'HEAD']), f.repo.head);
  assert.equal(fs.existsSync(path.dirname(f.logFile)), false);
});

test('respects a foreign index lock and leaves the saved repair outside the snapshot', (t) => {
  const f = fixture(t);
  const index = path.resolve(f.repo.root, git(f.repo.root, ['rev-parse', '--git-path', 'index']));
  const lock = `${index}.lock`;
  fs.writeFileSync(lock, 'foreign operation');
  assert.throws(() => publishRepair(f), /EEXIST.*Recovery bundle/);
  assert.equal(fs.readFileSync(lock, 'utf8'), 'foreign operation');
  assert.equal(git(f.repo.root, ['rev-parse', 'main']), f.repo.head);
  assert.equal(bundles(f).length, 1);
});

test('Git refuses working-file edits made after the index lock was obtained', (t) => {
  const f = fixture(t);
  assert.throws(() => publishRepair({ ...f, checkpoint: (phase) => {
    if (phase === 'locked') fs.writeFileSync(path.join(f.repo.root, 'source.txt'), 'concurrent user edit\n');
  } }), /Recovery bundle/);
  assert.equal(git(f.repo.root, ['rev-parse', 'main']), f.repo.head);
  assert.equal(fs.readFileSync(path.join(f.repo.root, 'source.txt'), 'utf8'), 'concurrent user edit\n');
  const index = path.resolve(f.repo.root, git(f.repo.root, ['rev-parse', '--git-path', 'index']));
  assert.equal(fs.existsSync(`${index}.lock`), false);
  assert.equal(git(f.repo.root, ['write-tree']), git(f.repo.root, ['rev-parse', 'HEAD^{tree}']));
});

test('preserves reviewed version on refusal and avoids another bump after successful repair', async (t) => {
  const f = fixture(t);
  const key = path.resolve(f.repo.root).toLowerCase();
  fs.mkdirSync(f.stateDirectory);
  const file = path.join(f.stateDirectory, 'version-state.json');
  const old = { schema: 1, repos: { [key]: { reviewed: { head: f.repo.head,
    tree: git(f.repo.root, ['rev-parse', 'HEAD^{tree}']), version: '1.2.3', reason: 'prepared' } } } };
  fs.writeFileSync(file, JSON.stringify(old));
  fs.writeFileSync(path.join(f.repo.root, 'untracked.txt'), 'ongoing');
  assert.throws(() => publishRepair(f), /uncommitted/);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), old);
  fs.rmSync(path.join(f.repo.root, 'untracked.txt'));
  const result = publishRepair(f);
  const prepared = await prepareVersions({ repos: [f.repo], stateDirectory: f.stateDirectory,
    review: () => assert.fail('repair must reuse the already prepared version'), log: () => {} });
  assert.equal(prepared[0].head, result.head);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).repos[key].reviewed.version, '1.2.3');
});

test('recovers a promoted ref before index publication and completes version state', (t) => {
  const f = fixture(t);
  assert.throws(() => publishRepair({ ...f, checkpoint: (phase) => {
    if (phase === 'promoted') throw new Error('interrupted after ref update');
  } }), /interrupted after ref update.*Recovery bundle/);
  const key = path.resolve(f.repo.root).toLowerCase();
  const plan = journal(f).repos[key];
  assert.equal(git(f.repo.root, ['rev-parse', 'main']), plan.head);
  assert.equal(fs.existsSync(plan.lock), true);
  assert.equal(fs.existsSync(path.join(f.stateDirectory, 'version-state.json')), false);
  recoverRepairPublications({ repos: [f.repo], stateDirectory: f.stateDirectory });
  assert.equal(fs.existsSync(plan.lock), false);
  assert.equal(fs.existsSync(plan.temporary), false);
  assert.equal(git(f.repo.root, ['status', '--porcelain']), '');
  const reviewed = JSON.parse(fs.readFileSync(path.join(f.stateDirectory, 'version-state.json'), 'utf8')).repos[key].reviewed;
  assert.equal(reviewed.head, plan.head);
  assert.equal(reviewed.tree, f.expectedTree);
  assert.deepEqual(journal(f).repos, {});
});

test('recovers review persistence after the index was already published', (t) => {
  const f = fixture(t);
  assert.throws(() => publishRepair({ ...f, checkpoint: (phase) => {
    if (phase === 'review') throw new Error('interrupted before review');
  } }), /interrupted before review/);
  assert.equal(git(f.repo.root, ['status', '--porcelain']), '');
  recoverRepairPublications({ repos: [f.repo], stateDirectory: f.stateDirectory });
  assert.deepEqual(journal(f).repos, {});
  assert.equal(fs.existsSync(path.join(f.stateDirectory, 'version-state.json')), true);
});

test('recovering an unpromoted journal leaves version review untouched', (t) => {
  const f = fixture(t);
  assert.throws(() => publishRepair({ ...f, checkpoint: (phase) => {
    if (phase === 'saved') throw new Error('interrupted before promotion');
  } }), /interrupted before promotion/);
  recoverRepairPublications({ repos: [f.repo], stateDirectory: f.stateDirectory });
  assert.equal(git(f.repo.root, ['rev-parse', 'main']), f.repo.head);
  assert.equal(fs.existsSync(path.join(f.stateDirectory, 'version-state.json')), false);
  assert.deepEqual(journal(f).repos, {});
  assert.equal(bundles(f).length, 1);
});
