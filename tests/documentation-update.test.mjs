import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { git } from '../scripts/smart-rebuild/repository.mjs';
import { documentationOnlyChanges } from '../scripts/smart-rebuild/documentation.mjs';
import { prepareBuildSources, prepareVersions } from '../scripts/smart-rebuild/version-review.mjs';
import { command, runIsolatedUpdate } from '../scripts/smart-rebuild/isolated.mjs';

function fixture(t, kinds = ['extension', 'desktop']) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-docs-update-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const write = (repo, file, text) => {
    fs.mkdirSync(path.dirname(path.join(repo.root, file)), { recursive: true });
    fs.writeFileSync(path.join(repo.root, file), text);
  };
  const commit = repo => {
    git(repo.root, ['add', '-A']);
    git(repo.root, ['commit', '-m', 'fixture change']);
    return git(repo.root, ['rev-parse', 'HEAD']);
  };
  const repos = kinds.map(kind => {
    const repo = { kind, name: kind, root: path.join(directory, kind), artifact: path.join(directory, 'outputs', kind) };
    fs.mkdirSync(repo.root);
    git(repo.root, ['init', '-b', 'main']);
    git(repo.root, ['config', 'user.email', '1@example.test']);
    git(repo.root, ['config', 'user.name', 'Test']);
    git(repo.root, ['config', 'core.autocrlf', 'false']);
    write(repo, 'package.json', '{"name":"fixture","version":"1.0.0"}');
    write(repo, 'package-lock.json', '{"version":"1.0.0"}');
    write(repo, kind === 'extension' ? 'manifest.json' : 'src-tauri/tauri.conf.json', '{"version":"1.0.0"}');
    if (kind === 'desktop') {
      write(repo, 'src-tauri/Cargo.toml', '[package]\nname = "atlas-desktop"\nversion = "1.0.0"\n');
      write(repo, 'src-tauri/Cargo.lock', '[[package]]\nname = "atlas-desktop"\nversion = "1.0.0"\n');
    }
    write(repo, 'source.txt', 'source');
    write(repo, 'README.md', 'README');
    write(repo, 'docs/setup.md', 'Setup');
    repo.base = commit(repo);
    return repo;
  });
  const commands = [];
  return { directory, repos, write, commit, commands, log: () => {}, stateDirectory: path.join(directory, 'state'),
    review: () => assert.fail('prose must not require version review'),
    scopeFactory: async () => ({ environment: { CARGO_TARGET_DIR: path.join(directory, 'target') }, close: async () => {} }),
    execute: async (name, args, options) => {
      commands.push([name, args]);
      if (name === 'git' || name === process.execPath) return command(name, args, options);
    },
    buildOverride: async repo => {
      if (repo.kind === 'extension') {
        const output = path.join(repo.snapshot, 'dist', 'atlas-extension-stable-validation');
        fs.mkdirSync(output, { recursive: true });
        fs.writeFileSync(path.join(output, 'manifest.json'), '{"version":"1.0.0"}');
      } else {
        fs.mkdirSync(path.dirname(repo.artifact), { recursive: true });
        fs.writeFileSync(repo.artifact, 'synthetic executable');
      }
    } };
}

test('docs-only update leaves versions, build receipts and outputs untouched and runs no commands', async t => {
  const f = fixture(t);
  await prepareBuildSources(f);
  await runIsolatedUpdate(f);
  const receipt = fs.readFileSync(path.join(f.stateDirectory, 'isolated-state.json'), 'utf8');
  for (const repo of f.repos) {
    f.write(repo, 'README.md', 'Revised README');
    f.write(repo, 'docs/nested/new guide.md', 'New prose');
    f.commit(repo);
  }
  f.commands.length = 0;
  const heads = f.repos.map(repo => git(repo.root, ['rev-parse', 'HEAD']));
  const prepared = await prepareBuildSources(f);
  const plans = await runIsolatedUpdate({ ...f, repos: prepared,
    scopeFactory: () => assert.fail('docs-only update must not allocate build storage') });
  assert.ok(plans.every(repo => !repo.needed && repo.documentationOnly));
  assert.deepEqual(f.commands, []);
  assert.deepEqual(f.repos.map(repo => git(repo.root, ['rev-parse', 'HEAD'])), heads);
  assert.equal(fs.readFileSync(path.join(f.stateDirectory, 'isolated-state.json'), 'utf8'), receipt);
  // Cumulative documentation drift remains safe without pretending it was built.
  for (const repo of f.repos) { f.write(repo, 'docs/setup.md', 'Later prose'); f.commit(repo); }
  assert.ok((await runIsolatedUpdate(f)).every(repo => !repo.needed));
});

test('missing or altered installed output rebuilds through all gates even after docs changes', async t => {
  const f = fixture(t);
  await prepareBuildSources(f);
  await runIsolatedUpdate(f);
  for (const repo of f.repos) { f.write(repo, 'README.md', 'New prose'); f.commit(repo); }
  fs.unlinkSync(path.join(f.repos[0].artifact, 'manifest.json'));
  fs.writeFileSync(f.repos[1].artifact, 'altered');
  f.commands.length = 0;
  const prepared = await prepareBuildSources(f);
  const plans = await runIsolatedUpdate({ ...f, repos: prepared });
  assert.ok(plans.every(repo => repo.needed));
  const checks = f.commands.filter(([name]) => name === 'pwsh.exe').map(([, args]) => args.join(' '));
  for (const check of ['check', 'lint', 'build:desktop:dev', 'test:unit', 'lint:rust', 'test:rust']) {
    assert.ok(checks.some(value => value.includes(`npm.cmd run ${check}`)), check);
  }
});

test('first run still builds and subsequent mixed code/docs changes preserve gates and version review', async t => {
  const f = fixture(t);
  for (const repo of f.repos) { f.write(repo, 'README.md', 'New prose'); f.commit(repo); }
  const first = await runIsolatedUpdate(f);
  assert.ok(first.every(repo => repo.needed));
  for (const repo of f.repos) {
    f.write(repo, 'docs/setup.md', 'More prose');
    f.write(repo, 'source.txt', 'changed code');
    f.commit(repo);
  }
  let reviews = 0;
  const prepared = await prepareVersions({ ...f, review: () => {
    reviews++;
    return { proceed: true, bump: 'patch', reason: 'Changed application code.' };
  } });
  assert.equal(reviews, 2);
  assert.ok(prepared.every(repo => JSON.parse(git(repo.root, ['show', `${repo.head}:package.json`])).version === '1.0.1'));
  f.commands.length = 0;
  assert.ok((await runIsolatedUpdate({ ...f, repos: prepared })).every(repo => repo.needed));
  assert.ok(f.commands.some(([, args]) => args.join(' ').includes('npm.cmd run test:rust')));
});

test('docs additions, deletion and rename are safe only when every old and new path is prose', t => {
  const f = fixture(t, ['extension']);
  const repo = f.repos[0];
  fs.renameSync(path.join(repo.root, 'docs/setup.md'), path.join(repo.root, 'docs/renamed guide.md'));
  fs.unlinkSync(path.join(repo.root, 'README.md'));
  assert.equal(documentationOnlyChanges(repo.root, repo.base, f.commit(repo)), true);
  fs.renameSync(path.join(repo.root, 'source.txt'), path.join(repo.root, 'docs/source.md'));
  assert.equal(documentationOnlyChanges(repo.root, repo.base, f.commit(repo)), false);
});

test('unknown/build assets, executable prose and symlinks do not bypass the pipeline', t => {
  const f = fixture(t, ['extension']);
  const repo = f.repos[0];
  for (const file of ['src/README.md', 'public/help.md', 'docs/fixture.json', 'scripts/task.mjs', 'unknown.md']) {
    f.write(repo, file, 'not exempt');
    const head = f.commit(repo);
    assert.equal(documentationOnlyChanges(repo.root, `${head}^`, head), false, file);
  }
  git(repo.root, ['update-index', '--chmod=+x', 'docs/setup.md']);
  git(repo.root, ['commit', '-m', 'executable prose']);
  assert.equal(documentationOnlyChanges(repo.root, 'HEAD^', 'HEAD'), false);
  const blob = git(repo.root, ['rev-parse', 'HEAD:docs/setup.md']);
  git(repo.root, ['update-index', '--cacheinfo', `120000,${blob},README.md`]);
  git(repo.root, ['commit', '-m', 'symlink fixture']);
  assert.equal(documentationOnlyChanges(repo.root, 'HEAD^', 'HEAD'), false);
  assert.equal(documentationOnlyChanges(repo.root, 'missing-baseline', 'HEAD'), false);
});

test('docs after a completed no-bump code review avoid another review without hiding unreviewed code', async t => {
  const f = fixture(t, ['extension']);
  const repo = f.repos[0];
  f.write(repo, 'source.txt', 'reviewed maintenance');
  f.commit(repo);
  let reviews = 0;
  await prepareVersions({ ...f, review: () => {
    reviews++;
    return { proceed: true, bump: 'none', reason: 'Covered maintenance.' };
  } });
  f.write(repo, 'docs/setup.md', 'Later prose');
  const head = f.commit(repo);
  await prepareVersions(f);
  assert.equal(reviews, 1);
  assert.equal(git(repo.root, ['rev-parse', 'HEAD']), head);
  // Removing review state reproduces an older updater's unversioned code: it
  // must still review the cumulative code instead of using successful build state.
  fs.unlinkSync(path.join(f.stateDirectory, 'version-state.json'));
  await prepareVersions({ ...f, review: () => {
    reviews++;
    return { proceed: true, bump: 'none', reason: 'Reviewed cumulative code.' };
  } });
  assert.equal(reviews, 2);
});

test('dry-run docs decisions agree with real planning without state or output mutations', async t => {
  const f = fixture(t);
  await runIsolatedUpdate(f);
  for (const repo of f.repos) { f.write(repo, 'README.md', 'Later prose'); f.commit(repo); }
  const files = ['isolated-state.json'].map(file => [file, fs.readFileSync(path.join(f.stateDirectory, file), 'utf8')]);
  const plans = await runIsolatedUpdate({ ...f, dryRun: true });
  assert.ok(plans.every(repo => !repo.needed && repo.documentationOnly));
  await prepareVersions({ ...f, dryRun: true });
  assert.equal(fs.existsSync(path.join(f.stateDirectory, 'version-state.json')), false);
  for (const [file, text] of files) assert.equal(fs.readFileSync(path.join(f.stateDirectory, file), 'utf8'), text);
});
