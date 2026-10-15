import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { git } from '../scripts/smart-rebuild/repository.mjs';
import { createCapturedSnapshots } from '../scripts/smart-rebuild/captured-snapshots.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'atlas-captured-snapshot-'));
  t.after(() => {
    assert.equal(path.dirname(fs.realpathSync(root)), fs.realpathSync(os.tmpdir()));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const source = path.join(root, 'source with spaces'), workspace = path.join(root, 'workspace');
  fs.mkdirSync(source); fs.mkdirSync(workspace);
  git(source, ['init', '-b', 'main']);
  git(source, ['config', 'user.email', '1@example.test']);
  git(source, ['config', 'user.name', 'Fixture']);
  fs.writeFileSync(path.join(source, 'fixture.txt'), 'committed');
  git(source, ['add', '.']); git(source, ['commit', '-m', 'fixture']);
  const plan = { id: 'fixture', source, snapshot: path.join(workspace, 'fixture'), head: git(source, ['rev-parse', 'HEAD']) };
  return { root, workspace, plan };
}

test('snapshot has independent objects and metadata and survives source removal', t => {
  const { root, workspace, plan } = fixture(t);
  createCapturedSnapshots([plan], workspace);
  assert.ok(fs.lstatSync(path.join(plan.snapshot, '.git')).isDirectory());
  assert.equal(fs.existsSync(path.join(plan.snapshot, '.git/objects/info/alternates')), false);
  const objects = path.join(plan.snapshot, '.git', 'objects');
  for (const entry of fs.readdirSync(objects, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) assert.equal(fs.statSync(path.join(entry.parentPath, entry.name)).nlink, 1);
  }
  assert.equal(fs.readFileSync(path.join(plan.snapshot, 'fixture.txt'), 'utf8'), 'committed');
  // Removing only the disposable fixture proves Git does not need source objects.
  assert.equal(path.dirname(fs.realpathSync(plan.source)), fs.realpathSync(root));
  fs.rmSync(plan.source, { recursive: true });
  assert.equal(git(plan.snapshot, ['show', 'HEAD:fixture.txt']), 'committed');
  git(plan.snapshot, ['fsck', '--full']);
});

test('rejects existing repositories, escaped paths and mutable refs before writing', t => {
  const { workspace, plan } = fixture(t);
  for (const change of [{ snapshot: plan.source }, { head: 'main' }, { snapshot: workspace }]) {
    assert.throws(() => createCapturedSnapshots([plan, { ...plan, ...change }], workspace), /snapshot|Snapshot/);
    assert.equal(fs.existsSync(plan.snapshot), false);
  }
  createCapturedSnapshots([plan], workspace);
  assert.throws(() => createCapturedSnapshots([plan], workspace), /fresh workspace path/);
});

test('reports the failed fixture and stage and does not copy later fixtures', t => {
  const { workspace, plan } = fixture(t);
  const later = { ...plan, id: 'later', snapshot: path.join(workspace, 'later') };
  assert.throws(() => createCapturedSnapshots([{ ...plan, head: '0'.repeat(40) }, later], workspace), /Snapshot fixture failed during fetch/);
  assert.equal(fs.existsSync(later.snapshot), false);
});

test('rejects a workspace directory alias that leads outside the managed workspace', t => {
  const { root, workspace, plan } = fixture(t);
  const outside = path.join(root, 'outside');
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(workspace, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => createCapturedSnapshots([{ ...plan, snapshot: path.join(workspace, 'escape', 'fixture') }], workspace), /escapes the workspace/);
  assert.deepEqual(fs.readdirSync(outside), []);
});
