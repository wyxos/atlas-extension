import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { artifactFingerprint, git } from '../scripts/smart-rebuild/repository.mjs';
import { command, runIsolatedUpdate } from '../scripts/smart-rebuild/isolated.mjs';
import { prepareYtdlpPin, recoverYtdlpPin } from '../scripts/smart-rebuild/ytdlp-preparation.mjs';
import { publishVersionCommit, committedText } from '../scripts/smart-rebuild/version-commit.mjs';
import { prepareBuildSources } from '../scripts/smart-rebuild/version-review.mjs';

const manifest = 'src-tauri/resources/media-tools/manifest.json';
function fixture(t, mode = 'stale') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-pin-preparation-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'desktop');
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.mkdirSync(path.dirname(path.join(root, manifest)), { recursive: true });
  git(root, ['init', '-b', 'main']);
  git(root, ['config', 'user.name', 'Fixture']);
  git(root, ['config', 'user.email', 'fixture@example.invalid']);
  git(root, ['config', 'core.autocrlf', 'false']);
  fs.writeFileSync(path.join(root, '.gitignore'), '.cache/\n');
  fs.writeFileSync(path.join(root, 'package.json'), '{"version":"1.0.0"}');
  fs.writeFileSync(path.join(root, 'src-tauri/tauri.conf.json'), '{"version":"1.0.0"}');
  fs.writeFileSync(path.join(root, 'source.txt'), 'initial');
  fs.writeFileSync(path.join(root, manifest), JSON.stringify({ ytDlp: { version: mode === 'current' ? 'new' : 'old', url: 'old', sha256: 'old', license: 'kept' }, deno: { version: 'kept' } }) + '\n');
  fs.writeFileSync(path.join(root, 'scripts/ytdlp-release.mjs'), `
    import assert from 'node:assert/strict'; import fs from 'node:fs';
    const file = ${JSON.stringify(manifest)};
    if (process.argv.includes('--check')) { assert.equal(JSON.parse(fs.readFileSync(file)).ytDlp.version, 'new'); }
    else {
      assert.deepEqual(process.argv.slice(2), ['--update-if-stale']);
      if (${JSON.stringify(mode)} === 'failure') throw new Error('fixture verification failure');
      const pin = JSON.parse(fs.readFileSync(file));
      if (pin.ytDlp.version !== 'new') {
        Object.assign(pin.ytDlp, { version: 'new', url: 'new', sha256: 'new' });
        if (${JSON.stringify(mode)} === 'unrelated') pin.deno.version = 'changed';
        fs.writeFileSync(file, JSON.stringify(pin));
      }
    }
  `);
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'initial version']);
  const head = git(root, ['rev-parse', 'HEAD']);
  const repo = { kind: 'desktop', name: 'Desktop', root, artifact: path.join(directory, 'installed.exe') };
  let scopes = 0, closed = 0;
  return { directory, root, head, repo, repos: [repo], stateDirectory: path.join(directory, 'state'), log: () => {},
    execute: command, scopeFactory: async (_root, _workspace, options) => {
      scopes++; assert.deepEqual(options, { rust: false });
      return { environment: {}, close: async () => { closed++; } };
    }, counts: () => ({ scopes, closed }) };
}
const pin = (f, head = 'main') => JSON.parse(committedText(f.root, head, manifest)).ytDlp.version;

test('verified pin commits before version review and the captured build completes with it', async t => {
  const f = fixture(t);
  let reviewed = false;
  const prepared = await prepareBuildSources({ ...f, review: context => {
    reviewed = true;
    assert.equal(pin(f, context.head), 'new');
    assert.equal(git(f.root, ['diff', '--name-only', f.head, context.head]), manifest);
    return { proceed: true, bump: 'none', reason: 'fixture prepared version' };
  } });
  assert.equal(reviewed, true);
  assert.equal(pin(f), 'new');
  assert.deepEqual(f.counts(), { scopes: 1, closed: 1 });
  let built = false;
  const result = await runIsolatedUpdate({ ...f, repos: prepared,
    scopeFactory: async () => ({ environment: { CARGO_TARGET_DIR: path.join(f.directory, 'target') }, close: async () => {} }),
    execute: (name, args, options) => name === process.execPath ? command(name, args, options) : Promise.resolve(),
    buildOverride: async repo => {
      built = true;
      assert.equal(JSON.parse(fs.readFileSync(path.join(repo.snapshot, manifest))).ytDlp.version, 'new');
      fs.writeFileSync(repo.artifact, 'fixture installer');
    },
  });
  assert.equal(built, true);
  assert.equal(result[0].head, prepared[0].head);
});

test('a current pin makes no source or version-state changes', async t => {
  const f = fixture(t, 'current');
  await prepareYtdlpPin(f);
  assert.equal(git(f.root, ['rev-parse', 'HEAD']), f.head);
  assert.equal(git(f.root, ['status', '--porcelain']), '');
  assert.equal(fs.existsSync(path.join(f.stateDirectory, 'version-state.json')), false);
});

test('Windows checkout line endings do not turn a current pin into a source change', async t => {
  const f = fixture(t, 'current');
  await prepareYtdlpPin({ ...f, execute: async (name, args, options) => {
    await command(name, args, options);
    if (args[0] !== 'scripts/ytdlp-release.mjs') return;
    git(options.cwd, ['config', 'core.autocrlf', 'true']);
    const file = path.join(options.cwd, manifest);
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/\r?\n/g, '\r\n'));
  } });
  assert.equal(git(f.root, ['rev-parse', 'HEAD']), f.head);
  assert.equal(git(f.root, ['status', '--porcelain']), '');
});

test('pin-only publication preserves unrelated staged, unstaged and untracked edits', async t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, 'source.txt'), 'staged');
  git(f.root, ['add', 'source.txt']);
  fs.writeFileSync(path.join(f.root, 'source.txt'), 'unfinished');
  fs.writeFileSync(path.join(f.root, 'untracked.txt'), 'private fixture');
  const before = git(f.root, ['status', '--porcelain']);
  await prepareYtdlpPin(f);
  assert.equal(pin(f), 'new');
  assert.equal(git(f.root, ['status', '--porcelain']), before);
  assert.equal(git(f.root, ['show', ':source.txt']), 'staged');
  assert.equal(fs.readFileSync(path.join(f.root, 'source.txt'), 'utf8'), 'unfinished');
});

test('publication updates main while preserving a launching feature branch and its pin edits', async t => {
  const f = fixture(t);
  git(f.root, ['switch', '-c', 'ongoing']);
  fs.writeFileSync(path.join(f.root, manifest), 'unfinished branch pin');
  await prepareYtdlpPin(f);
  assert.equal(pin(f), 'new');
  assert.equal(git(f.root, ['symbolic-ref', 'HEAD']), 'refs/heads/ongoing');
  assert.equal(git(f.root, ['rev-parse', 'HEAD']), f.head);
  assert.equal(fs.readFileSync(path.join(f.root, manifest), 'utf8'), 'unfinished branch pin');
});

test('verification failures and unrelated pin changes stop before source commits and version review', async t => {
  for (const mode of ['failure', 'unrelated']) {
    const f = fixture(t, mode);
    await assert.rejects(prepareBuildSources({ ...f, review: () => assert.fail('must not review failed pins') }), /pin preparation failed/);
    assert.equal(git(f.root, ['rev-parse', 'main']), f.head);
    assert.equal(git(f.root, ['status', '--porcelain']), '');
    assert.deepEqual(f.counts(), { scopes: 1, closed: 1 });
    assert.deepEqual(fs.readdirSync(path.join(f.stateDirectory, 'workspaces')), []);
  }
});

test('conflicting main pin edits and concurrent main changes are preserved', async t => {
  for (const scenario of ['pin-edit', 'main-move']) {
    const f = fixture(t);
    let expected;
    await assert.rejects(prepareYtdlpPin({ ...f, publish: (repo, plan) => {
      if (scenario === 'pin-edit') fs.writeFileSync(path.join(f.root, manifest), 'unfinished pin');
      else { fs.writeFileSync(path.join(f.root, 'source.txt'), 'new source'); git(f.root, ['commit', '-am', 'new source']); }
      expected = git(f.root, ['rev-parse', 'main']);
      publishVersionCommit(repo, plan);
    } }), /pin preparation failed/);
    assert.equal(git(f.root, ['rev-parse', 'main']), expected);
    if (scenario === 'pin-edit') assert.equal(fs.readFileSync(path.join(f.root, manifest), 'utf8'), 'unfinished pin');
  }
});

test('pin publication recovers file/ref interruptions before dirty-source handling without another commit', async t => {
  for (const point of ['file', 'ref']) {
    const f = fixture(t);
    await assert.rejects(prepareYtdlpPin({ ...f, publish: (repo, plan) => publishVersionCommit(repo, plan, step => {
      if (step === point) throw new Error('fixture interruption');
    }) }), /pin preparation failed/);
    const state = JSON.parse(fs.readFileSync(path.join(f.stateDirectory, 'ytdlp-pin-state.json')));
    const saved = state.repos[path.resolve(f.root).toLowerCase()].head;
    const originalScopes = f.counts().scopes;
    await prepareBuildSources({ ...f, choose: () => assert.fail('recover first'),
      scopeFactory: async () => { throw new Error('stop after recovery'); } }).catch(error => assert.match(error.message, /stop after recovery/));
    assert.equal(git(f.root, ['rev-parse', 'main']), saved);
    assert.equal(pin(f), 'new');
    assert.deepEqual(f.counts(), { scopes: originalScopes, closed: originalScopes });
    recoverYtdlpPin(f);
    assert.equal(git(f.root, ['rev-parse', 'main']), saved);
  }
});

test('dry-run, unchanged Desktop and documentation-only builds skip network and scope acquisition', async t => {
  const f = fixture(t, 'failure');
  await prepareYtdlpPin({ ...f, dryRun: true });
  fs.writeFileSync(f.repo.artifact, 'installed fixture');
  fs.mkdirSync(f.stateDirectory);
  const state = { schema: 1, repos: { [path.resolve(f.root).toLowerCase()]: {
    tree: git(f.root, ['rev-parse', 'main^{tree}']), artifact: artifactFingerprint(f.repo.artifact),
  } } };
  fs.writeFileSync(path.join(f.stateDirectory, 'isolated-state.json'), JSON.stringify(state));
  await prepareYtdlpPin(f);
  fs.writeFileSync(path.join(f.root, 'README.md'), 'only prose');
  git(f.root, ['add', 'README.md']); git(f.root, ['commit', '-m', 'docs']);
  await prepareYtdlpPin(f);
  assert.deepEqual(f.counts(), { scopes: 0, closed: 0 });
  assert.equal(fs.existsSync(path.join(f.stateDirectory, 'workspaces')), false);
});
