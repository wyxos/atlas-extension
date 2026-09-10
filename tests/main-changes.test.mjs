import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { git } from '../scripts/smart-rebuild/repository.mjs';
import { mainCheckout, prepareMainChanges } from '../scripts/smart-rebuild/main-changes.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-main-choice-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  git(root, ['init', '-b', 'main']);
  git(root, ['config', 'user.email', 'test@example.invalid']);
  git(root, ['config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(root, 'source.txt'), 'initial');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'initial']);
  fs.writeFileSync(path.join(root, 'source.txt'), 'updated');
  return { root, repos: [{ kind: 'extension', name: 'Extension', root }], stateDirectory: path.join(root, 'state'), log: () => {} };
}

test('choice skips dirty main without reviewing or changing staging', async (t) => {
  const f = fixture(t);
  const head = git(f.root, ['rev-parse', 'HEAD']);
  await prepareMainChanges({ ...f, choose: async () => 'skip', review: () => assert.fail('must not review') });
  assert.equal(git(f.root, ['rev-parse', 'HEAD']), head);
  assert.equal(git(f.root, ['status', '--porcelain']), ' M source.txt');
});

test('Codex choice commits captured main without bumps or working file rewrites', async (t) => {
  const f = fixture(t);
  await prepareMainChanges({ ...f, choose: async () => 'commit', review: () => 'fix: improve source' });
  assert.equal(git(f.root, ['log', '-1', '--format=%s']), 'fix: improve source');
  assert.equal(git(f.root, ['status', '--porcelain']), '');
  assert.equal(fs.readFileSync(path.join(f.root, 'source.txt'), 'utf8'), 'updated');
});

test('edits during Codex review abort without committing and release the index lock', async (t) => {
  const f = fixture(t);
  const head = git(f.root, ['rev-parse', 'HEAD']);
  await assert.rejects(prepareMainChanges({ ...f, choose: async () => 'commit', review: () => {
    fs.writeFileSync(path.join(f.root, 'source.txt'), 'newer ongoing edit');
    return 'fix: source';
  } }), /changed/);
  assert.equal(git(f.root, ['rev-parse', 'HEAD']), head);
  assert.equal(fs.existsSync(path.join(f.root, '.git', 'index.lock')), false);
});

test('finds main when the launching checkout is on another branch', async (t) => {
  const f = fixture(t);
  git(f.root, ['checkout', '--', 'source.txt']);
  git(f.root, ['switch', '-c', 'feature']);
  const main = path.join(f.root, 'main-worktree');
  git(f.root, ['worktree', 'add', main, 'main']);
  assert.equal(fs.realpathSync(mainCheckout(f.root)), fs.realpathSync(main));
  fs.writeFileSync(path.join(main, 'source.txt'), 'main edit');
  await prepareMainChanges({ ...f, choose: async () => 'commit', review: () => 'fix: main edit' });
  assert.equal(git(main, ['status', '--porcelain']), '');
  assert.equal(git(f.root, ['branch', '--show-current']), 'feature');
});
