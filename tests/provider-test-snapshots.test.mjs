import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { git } from '../scripts/smart-rebuild/repository.mjs';
import { command } from '../scripts/smart-rebuild/isolated.mjs';
import { prepareProviderTestSnapshots } from '../scripts/smart-rebuild/provider-test-snapshots.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'atlas-provider-snapshot-'));
  t.after(() => {
    assert.equal(path.dirname(fs.realpathSync(root)), fs.realpathSync(os.tmpdir()));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const desktop = { root: path.join(root, 'source', 'desktop'), snapshot: path.join(root, 'run-fixture', 'desktop') };
  fs.mkdirSync(path.join(desktop.snapshot, 'scripts'), { recursive: true });
  const workspace = path.dirname(desktop.snapshot);
  const sources = ['civitai', 'wallhaven'].map(id => {
    const source = path.join(root, 'source', `provider ${id}`);
    fs.mkdirSync(source, { recursive: true });
    git(source, ['init', '-b', 'main']);
    git(source, ['config', 'user.email', 'test@example.invalid']);
    git(source, ['config', 'user.name', 'Test']);
    fs.writeFileSync(path.join(source, 'manifest.json'), JSON.stringify({ id }));
    fs.writeFileSync(path.join(source, 'Cargo.toml'), '# committed fixture');
    git(source, ['add', '.']);
    git(source, ['commit', '-m', 'fixture']);
    const head = git(source, ['rev-parse', 'HEAD']);
    fs.writeFileSync(path.join(source, 'Cargo.toml'), '# staged private work');
    git(source, ['add', '.']);
    fs.writeFileSync(path.join(source, 'Cargo.toml'), '# uncommitted private work');
    return { id, source, head };
  });
  const env = { ATLAS_TEST_PROVIDER_SOURCES: JSON.stringify(Object.fromEntries(sources.map(({id, source}) => [id, source]))) };
  fs.writeFileSync(path.join(desktop.snapshot, 'scripts', 'provider-test-sources.mjs'), `
    export function providerTestSources(root, env) {
      if (env.ATLAS_CHECKOUT_INFO) throw new Error("Wrong scope metadata");
      const sources = Object.entries(JSON.parse(env.ATLAS_TEST_PROVIDER_SOURCES)).map(([id, source]) => ({id, source}));
      return [...sources, {id: "exampleunknown", source: root + "/providers/example-unknown"}];
    }`);
  const run = (name, args, cwd) => command(name, args, { cwd, env: {}, logFile: path.join(root, 'commands.log') });
  return { root, desktop, workspace, sources, env, run };
}

test('provider fixtures use captured commits, preserve edits, and map only temporary checkouts', async t => {
  const f = fixture(t);
  const before = f.sources.map(({source}) => [git(source, ['status', '--porcelain']), git(source, ['write-tree'])]);
  let moved = false;
  const overrides = await prepareProviderTestSnapshots({ ...f, run: async (...args) => {
    if (!moved) {
      moved = true;
      for (const {source} of f.sources) {
        const later = git(source, ['commit-tree', git(source, ['rev-parse', 'HEAD^{tree}']), '-p', 'HEAD', '-m', 'later commit']);
        git(source, ['update-ref', 'refs/heads/main', later]);
      }
    }
    return f.run(...args);
  } });
  assert.deepEqual(Object.keys(overrides).sort(), ['civitai', 'wallhaven']);
  for (const {id, source, head} of f.sources) {
    assert.equal(overrides[id], path.join(f.workspace, 'provider-tests', id));
    assert.equal(git(overrides[id], ['rev-parse', 'HEAD']), head);
    assert.notEqual(git(source, ['rev-parse', 'main']), head);
    assert.equal(fs.readFileSync(path.join(overrides[id], 'Cargo.toml'), 'utf8'), '# committed fixture');
  }
  assert.deepEqual(f.sources.map(({source}) => [git(source, ['status', '--porcelain']), git(source, ['write-tree'])]), before);
});

test('missing committed main fails before starting snapshot commands', async t => {
  const f = fixture(t);
  git(f.sources[1].source, ['branch', '-m', 'unfinished']);
  let called = false;
  await assert.rejects(prepareProviderTestSnapshots({ ...f, run: async () => { called = true; } }), /committed main branch/);
  assert.equal(called, false);
});

test('committed provider identity is checked instead of trusting a dirty manifest', async t => {
  const f = fixture(t);
  const source = f.sources[0].source;
  fs.writeFileSync(path.join(source, 'manifest.json'), '{"id":"different"}');
  git(source, ['add', 'manifest.json']);
  git(source, ['commit', '-m', 'wrong identity']);
  fs.writeFileSync(path.join(source, 'manifest.json'), '{"id":"civitai"}');
  await assert.rejects(prepareProviderTestSnapshots(f), /Committed provider test source does not match civitai/);
});

test('older Desktop revisions do not require external provider repositories', async t => {
  const f = fixture(t);
  fs.unlinkSync(path.join(f.desktop.snapshot, 'scripts', 'provider-test-sources.mjs'));
  assert.equal(await prepareProviderTestSnapshots({ ...f, run: () => assert.fail('Unexpected snapshot') }), null);
});
