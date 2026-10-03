import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { artifactFingerprint, git } from '../scripts/smart-rebuild/repository.mjs';
import { command, CommandFailure, runIsolatedUpdate } from '../scripts/smart-rebuild/isolated.mjs';
import { canRepairFailure, cargoWorkspaceManifests } from '../scripts/smart-rebuild/repair-policy.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-repair-update-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repos = ['extension', 'desktop'].map(kind => {
    const directory = path.join(root, kind);
    fs.mkdirSync(directory);
    git(directory, ['init', '-b', 'main']);
    git(directory, ['config', 'user.name', 'Test']);
    git(directory, ['config', 'user.email', 'test@example.invalid']);
    fs.writeFileSync(path.join(directory, '.gitignore'), 'dist/\nnode_modules/\n.cache/\n');
    fs.writeFileSync(path.join(directory, 'source.txt'), 'broken');
    fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ version: '1.0.0', scripts: { check: 'node test.mjs' } }));
    const manifest = kind === 'desktop' ? 'src-tauri/tauri.conf.json' : 'manifest.json';
    fs.mkdirSync(path.dirname(path.join(directory, manifest)), { recursive: true });
    fs.writeFileSync(path.join(directory, manifest), '{"version":"1.0.0"}');
    git(directory, ['add', '.']);
    git(directory, ['commit', '-m', 'initial']);
    return { kind, name: kind, root: directory, artifact: path.join(root, 'outputs', kind) };
  });
  return { root, repos, stateDirectory: path.join(root, 'state'), log: () => {},
    scopeFactory: async () => ({ environment: { CARGO_TARGET_DIR: path.join(root, 'target') }, close: async () => {} }),
    execute: (name, args, options) => name === 'git' ? command(name, args, options) : Promise.resolve(),
    buildOverride: async repo => {
      const output = repo.kind === 'extension'
        ? path.join(repo.snapshot, 'dist', 'atlas-extension-stable-validation') : path.dirname(repo.artifact);
      fs.mkdirSync(output, { recursive: true });
      fs.writeFileSync(repo.kind === 'extension' ? path.join(output, 'manifest.json') : repo.artifact, 'verified fixture');
    } };
}

const scriptName = args => /npm\.cmd run ([^ ;]+)/.exec(args.join(' '))?.[1];
const failure = (name, args) => new CommandFailure(name, args, 1, null, 'AssertionError: synthetic regression');

test('a validation failure calls Codex, independently checks the fix, commits and continues', async t => {
  const f = fixture(t);
  let checks = 0, repairs = 0;
  const oldHead = git(f.repos[0].root, ['rev-parse', 'HEAD']);
  const plans = await runIsolatedUpdate({ ...f,
    execute: async (name, args, options) => {
      if (scriptName(args) === 'check' && ++checks === 1) throw failure(name, args);
      return f.execute(name, args, options);
    },
    repair: async ({ repo, failure: evidence, env }) => {
      repairs++;
      assert.equal(env.ATLAS_UPDATER_REPAIR_ACTIVE, '1');
      assert.notEqual(repo.snapshot, repo.root);
      assert.match(evidence.diagnostics, /synthetic regression/);
      fs.writeFileSync(path.join(repo.snapshot, 'source.txt'), 'fixed');
    },
  });
  assert.equal(checks, 2);
  assert.equal(repairs, 1);
  assert.equal(fs.readFileSync(path.join(f.repos[0].root, 'source.txt'), 'utf8'), 'fixed');
  assert.notEqual(plans[0].head, oldHead);
  assert.equal(plans[0].head, git(f.repos[0].root, ['rev-parse', 'main']));
  const state = JSON.parse(fs.readFileSync(path.join(f.stateDirectory, 'isolated-state.json'), 'utf8'));
  assert.equal(state.repos[path.resolve(f.repos[0].root).toLowerCase()].head, plans[0].head);
  assert.deepEqual(fs.readdirSync(path.join(f.stateDirectory, 'workspaces')), []);
});

test('a later Desktop failure restarts earlier passing checks after repair', async t => {
  const f = fixture(t);
  const calls = [];
  let repaired = false;
  await runIsolatedUpdate({ ...f,
    execute: async (name, args, options) => {
      const script = scriptName(args);
      if (path.basename(options.cwd) === 'desktop' && script) {
        calls.push(script);
        if (script === 'test:unit' && !repaired) throw failure(name, args);
      }
      return f.execute(name, args, options);
    },
    repair: async ({ repo }) => { repaired = true; fs.writeFileSync(path.join(repo.snapshot, 'source.txt'), 'fixed'); },
  });
  assert.deepEqual(calls.slice(0, 6), ['lint', 'build:desktop:dev', 'test:unit', 'lint', 'build:desktop:dev', 'test:unit']);
  assert.equal(calls.filter(value => value === 'test:rust').length, 1);
});

test('Extension compilation failures repair before committing or publishing the replacement', async t => {
  const f = fixture(t);
  const desktop = f.repos[1];
  fs.mkdirSync(path.dirname(desktop.artifact), { recursive: true });
  fs.writeFileSync(desktop.artifact, 'existing desktop');
  fs.mkdirSync(f.stateDirectory);
  fs.writeFileSync(path.join(f.stateDirectory, 'isolated-state.json'), JSON.stringify({ schema: 1, repos: {
    [path.resolve(desktop.root).toLowerCase()]: { tree: git(desktop.root, ['rev-parse', 'HEAD^{tree}']), artifact: artifactFingerprint(desktop.artifact) },
  } }));
  const head = git(f.repos[0].root, ['rev-parse', 'main']);
  let builds = 0;
  await runIsolatedUpdate({ ...f, buildOverride: undefined,
    execute: async (name, args, options) => {
      if (args.includes('-File')) {
        builds++;
        assert.equal(git(f.repos[0].root, ['rev-parse', 'main']), head);
        if (builds === 1) throw failure(name, args);
        const output = path.join(options.cwd, 'dist', 'atlas-extension-stable-validation');
        fs.mkdirSync(output, { recursive: true });
        fs.writeFileSync(path.join(output, 'manifest.json'), 'compiled fix');
      }
      return f.execute(name, args, options);
    }, repair: async ({ repo }) => fs.writeFileSync(path.join(repo.snapshot, 'source.txt'), 'fixed'),
  });
  assert.equal(builds, 2);
  assert.notEqual(git(f.repos[0].root, ['rev-parse', 'main']), head);
  assert.equal(fs.readFileSync(path.join(f.repos[0].artifact, 'manifest.json'), 'utf8'), 'compiled fix');
});

test('failed repairs stop at the retry limit without publishing source or output', async t => {
  const f = fixture(t);
  let repairs = 0;
  const head = git(f.repos[0].root, ['rev-parse', 'main']);
  await assert.rejects(runIsolatedUpdate({ ...f,
    execute: async (name, args, options) => {
      if (scriptName(args) === 'check') throw failure(name, args);
      return f.execute(name, args, options);
    },
    repair: async ({ repo }) => fs.writeFileSync(path.join(repo.snapshot, 'source.txt'), `attempt ${++repairs}`),
  }), /validate.*failed/);
  assert.equal(repairs, 2);
  assert.equal(git(f.repos[0].root, ['rev-parse', 'main']), head);
  assert.equal(fs.existsSync(f.repos[0].artifact), false);
  assert.match(fs.readFileSync(path.join(f.stateDirectory, 'repair-extension-2.patch'), 'utf8'), /attempt 2/);
});

test('no-change and validation-command changes are rejected before publication', async t => {
  for (const changeScripts of [false, true]) {
    const f = fixture(t);
    await assert.rejects(runIsolatedUpdate({ ...f,
      execute: async (name, args, options) => {
        if (scriptName(args) === 'check') throw failure(name, args);
        return f.execute(name, args, options);
      },
      repair: async ({ repo }) => {
        if (changeScripts) fs.writeFileSync(path.join(repo.snapshot, 'package.json'), '{"version":"1.0.0","scripts":{"check":"exit 0"}}');
      },
    }), changeScripts ? /validation commands/ : /no source changes/);
  }
});

test('install failures and cancellation never invoke Codex', async t => {
  for (const cancel of [false, true]) {
    const f = fixture(t);
    let repairs = 0;
    await assert.rejects(runIsolatedUpdate({ ...f,
      execute: async (name, args, options) => {
        if (name !== 'git' && (!cancel || scriptName(args) === 'check')) {
          throw new CommandFailure(name, args, cancel ? null : 1, cancel ? 'SIGTERM' : null, 'fixture');
        }
        return f.execute(name, args, options);
      },
      repair: async () => { repairs++; },
    }));
    assert.equal(repairs, 0);
  }
});

test('storage, compiler-cache failures, managed cancellation and recursive calls do not invoke repair', async t => {
  const f = fixture(t);
  for (const diagnostic of ['Atlas build stopped: disk capacity is exhausted.', 'Atlas runtime interrupted.',
    'Build storage ownership could not be verified.', 'Updater build scope cleanup failed.',
    'spawn missing-tool.exe ENOENT', 'spawn blocked-tool.exe EACCES', 'spawn denied-tool.exe EPERM',
    'sccache: error: An operation on a socket could not be performed because the system lacked sufficient buffer space or because a queue was full. (os error 10055)',
    'sccache: error: failed to connect to the compiler cache server']) {
    let repairs = 0;
    await assert.rejects(runIsolatedUpdate({ ...f,
      execute: async (name, args, options) => {
        if (scriptName(args) === 'check') throw new CommandFailure(name, args, 1, null, diagnostic);
        return f.execute(name, args, options);
      }, repair: async () => { repairs++; },
    }));
    assert.equal(repairs, 0);
  }
  const previous = process.env.ATLAS_UPDATER_REPAIR_ACTIVE;
  process.env.ATLAS_UPDATER_REPAIR_ACTIVE = '1';
  try { await assert.rejects(runIsolatedUpdate({ ...f, dryRun: true }), /cannot start another/); }
  finally {
    if (previous === undefined) delete process.env.ATLAS_UPDATER_REPAIR_ACTIVE;
    else process.env.ATLAS_UPDATER_REPAIR_ACTIVE = previous;
  }
});

test('a cache fallback message does not hide an application compile failure', () => {
  assert.equal(canRepairFailure(new CommandFailure('cargo', ['check'], 1, null,
    'Compiler cache unavailable; compiling without cached results.\nerror[E0308]: mismatched types')), true);
  assert.equal(canRepairFailure(new CommandFailure('node', ['test.mjs'], 1, null,
    'AssertionError: ENOENT while reading the generated source fixture')), true);
});

test('source changes during repair verification still prevent publication', async t => {
  const f = fixture(t);
  const head = git(f.repos[0].root, ['rev-parse', 'main']);
  let repaired = false;
  await assert.rejects(runIsolatedUpdate({ ...f,
    execute: async (name, args, options) => {
      if (scriptName(args) === 'check' && !repaired) throw failure(name, args);
      return f.execute(name, args, options);
    }, repair: async ({ repo }) => {
      repaired = true;
      fs.writeFileSync(path.join(repo.snapshot, 'source.txt'), 'fixed');
    }, buildOverride: async repo => {
      await f.buildOverride(repo);
      if (repo.kind === 'extension') fs.writeFileSync(path.join(repo.snapshot, 'source.txt'), 'changed during build');
    },
  }), /Repair changed while checks were running/);
  assert.equal(git(f.repos[0].root, ['rev-parse', 'main']), head);
  assert.equal(fs.existsSync(f.repos[0].artifact), false);
});

test('agent staging and version changes are refused before retrying checks', async t => {
  for (const stage of [false, true]) {
    const f = fixture(t);
    await assert.rejects(runIsolatedUpdate({ ...f,
      execute: async (name, args, options) => {
        if (scriptName(args) === 'check') throw failure(name, args);
        return f.execute(name, args, options);
      }, repair: async ({ repo }) => {
        fs.writeFileSync(path.join(repo.snapshot, 'source.txt'), 'fixed');
        if (stage) git(repo.snapshot, ['add', '.']);
        else fs.writeFileSync(path.join(repo.snapshot, 'manifest.json'), '{"version":"9.9.9"}');
      },
    }), stage ? /history or staging/ : /release versions/);
  }
});

test('a dependency fix reinstalls before its full validation retry', async t => {
  const f = fixture(t);
  const calls = [];
  let repaired = false;
  await runIsolatedUpdate({ ...f,
    execute: async (name, args, options) => {
      if (path.basename(options.cwd) === 'extension' && name !== 'git') {
        calls.push(scriptName(args) ?? 'install');
        if (scriptName(args) === 'check' && !repaired) throw failure(name, args);
      }
      return f.execute(name, args, options);
    },
    repair: async ({ repo }) => {
      repaired = true;
      const file = path.join(repo.snapshot, 'package.json');
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      data.devDependencies = { fixture: '1.0.0' };
      fs.writeFileSync(file, JSON.stringify(data));
    },
  });
  assert.deepEqual(calls, ['install', 'check', 'install', 'check']);
});

test('Cargo repairs resolve lockfile changes before freezing the verified source tree', async t => {
  const f = fixture(t);
  const desktop = f.repos[1];
  const cargoFile = path.join(desktop.root, 'src-tauri', 'Cargo.toml');
  const lockFile = path.join(desktop.root, 'src-tauri', 'Cargo.lock');
  const cargo = '[package]\nname = "atlas-desktop"\nversion = "1.0.0"\n';
  const lock = '[[package]]\nname = "atlas-desktop"\nversion = "1.0.0"\n';
  fs.writeFileSync(cargoFile, cargo);
  fs.writeFileSync(lockFile, lock);
  git(desktop.root, ['add', '.']);
  git(desktop.root, ['commit', '-m', 'add native dependency fixture']);
  const calls = [];
  let repaired = false;
  await runIsolatedUpdate({ ...f,
    execute: async (name, args, options) => {
      if (name === 'cargo') {
        if (args[0] === 'locate-project') {
          assert.equal(options.captureStdout, true);
          return { stdout: JSON.stringify({ root: path.join(options.cwd, 'src-tauri/Cargo.toml') }) };
        }
        assert.deepEqual(args, ['update', '--workspace', '--manifest-path', 'src-tauri/Cargo.toml']);
        calls.push('resolve');
        fs.writeFileSync(path.join(options.cwd, 'src-tauri', 'Cargo.lock'), lock + '[[package]]\nname = "fixture"\nversion = "1.0.0"\n');
      }
      if (path.basename(options.cwd) === 'desktop' && scriptName(args)) {
        calls.push(scriptName(args));
        if (scriptName(args) === 'test:unit' && !repaired) throw failure(name, args);
      }
      return f.execute(name, args, options);
    }, repair: async ({ repo }) => {
      repaired = true;
      fs.writeFileSync(path.join(repo.snapshot, 'src-tauri', 'Cargo.toml'), cargo + '[dependencies]\nfixture = "1.0.0"\n');
    },
  });
  assert.deepEqual(calls.slice(0, 5), ['lint', 'build:desktop:dev', 'test:unit', 'resolve', 'lint']);
  assert.match(fs.readFileSync(lockFile, 'utf8'), /name = "fixture"/);
});

test('a shared Cargo path dependency preflights importer and provider workspaces before retrying checks', async t => {
  const f = fixture(t);
  const desktop = f.repos[1];
  const workspaces = ['providers/example-unknown/Cargo.toml', 'src-tauri/Cargo.toml', 'src-tauri/importer/Cargo.toml'];
  const manifests = {
    'src-tauri/Cargo.toml': '[package]\nname = "atlas-desktop"\nversion = "1.0.0"\n[workspace]\nmembers = [".", "provider-abi"]\n',
    'src-tauri/provider-abi/Cargo.toml': '[package]\nname = "atlas-provider-abi"\nversion = "0.1.0"\n',
    'src-tauri/importer/Cargo.toml': '[package]\nname = "atlas-web-importer"\nversion = "0.1.0"\n[workspace]\n[dependencies]\natlas-provider-abi = { path = "../provider-abi" }\n',
    'providers/example-unknown/Cargo.toml': '[package]\nname = "example-unknown"\nversion = "0.1.0"\n[workspace]\n[dependencies]\natlas-provider-abi = { path = "../../src-tauri/provider-abi" }\n',
  };
  const locked = '[[package]]\nname = "atlas-desktop"\nversion = "1.0.0"\n[[package]]\nname = "unrelated-locked"\nversion = "9.1.0"\n';
  for (const [file, contents] of Object.entries(manifests)) {
    const location = path.join(desktop.root, file);
    fs.mkdirSync(path.dirname(location), { recursive: true });
    fs.writeFileSync(location, contents);
  }
  for (const file of workspaces) fs.writeFileSync(path.join(desktop.root, path.dirname(file), 'Cargo.lock'), locked);
  git(desktop.root, ['add', '.']);
  git(desktop.root, ['commit', '-m', 'add independent workspace fixtures']);
  let repaired = false;
  const resolved = [];
  await runIsolatedUpdate({ ...f,
    execute: async (name, args, options) => {
      if (name === 'cargo') {
        if (args[0] === 'locate-project') {
          assert.equal(options.captureStdout, true);
          const manifest = args.at(-1) === 'src-tauri/provider-abi/Cargo.toml' ? 'src-tauri/Cargo.toml' : args.at(-1);
          return { stdout: JSON.stringify({ root: path.join(options.cwd, manifest) }) };
        }
        assert.deepEqual(args.slice(0, 3), ['update', '--workspace', '--manifest-path']);
        resolved.push(args[3]);
        assert.ok(workspaces.includes(args[3]), 'A workspace member must not be resolved as a separate root');
        fs.writeFileSync(path.join(options.cwd, path.dirname(args[3]), 'Cargo.lock'),
          locked + '[[package]]\nname = "new-path-dependency"\nversion = "1.0.0"\n');
      }
      if (path.basename(options.cwd) === 'desktop') {
        const script = scriptName(args);
        if (script === 'test:unit' && !repaired) throw failure(name, args);
        if (repaired && script) assert.deepEqual(resolved, workspaces, 'All shared dependency graphs must resolve before validation');
      }
      return f.execute(name, args, options);
    }, repair: async ({ repo }) => {
      repaired = true;
      fs.writeFileSync(path.join(repo.snapshot, 'src-tauri/provider-abi/Cargo.toml'),
        manifests['src-tauri/provider-abi/Cargo.toml'] + '[dependencies]\nnew-path-dependency = "1.0.0"\n');
    },
  });
  assert.deepEqual(resolved, workspaces);
  for (const manifest of workspaces) {
    const lock = fs.readFileSync(path.join(desktop.root, path.dirname(manifest), 'Cargo.lock'), 'utf8');
    assert.ok(lock.replaceAll('\r\n', '\n').startsWith(locked), 'Existing unrelated locked package versions remain in the verified tree');
    assert.match(lock, /name = "new-path-dependency"/);
  }
});

test('Cargo discovery includes an excluded standalone crate and refuses an external workspace before updating', async t => {
  const f = fixture(t);
  const repo = { ...f.repos[1], snapshot: f.repos[1].root };
  const files = ['src-tauri/Cargo.toml', 'src-tauri/tools/standalone/Cargo.toml'];
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(repo.snapshot, file)), { recursive: true });
    fs.writeFileSync(path.join(repo.snapshot, file), file === files[0]
      ? '[workspace]\nexclude = ["tools/standalone"]\n' : '[package]\nname = "standalone"\nversion = "1.0.0"\n');
  }
  const located = [];
  const roots = await cargoWorkspaceManifests(repo, async manifest => {
    located.push(manifest);
    return { stdout: `Atlas runtime:external: isolated environment fixture.\n${JSON.stringify({ root: path.join(repo.snapshot, manifest) })}\n` };
  });
  assert.deepEqual(roots, files);
  assert.deepEqual(located, files);
  const external = path.join(f.root, 'outer', 'Cargo.toml');
  fs.mkdirSync(path.dirname(external));
  fs.writeFileSync(external, '[workspace]\n');
  await assert.rejects(cargoWorkspaceManifests(repo, async manifest => ({
    stdout: JSON.stringify({ root: manifest === files[1] ? external : path.join(repo.snapshot, manifest) }),
  })), /Cargo workspace escaped the isolated checkout/);
});

test('command failures expose only that invocation and redaction handles split chunks', async t => {
  const f = fixture(t);
  const logFile = path.join(f.root, 'command.log');
  fs.writeFileSync(logFile, 'Earlier unrelated failure\n');
  await assert.rejects(command(process.execPath, ['-e', 'console.error("current assertion"); process.exit(1)'],
    { cwd: f.root, env: process.env, logFile }), error => {
    assert.equal(error.exitCode, 1);
    assert.match(error.diagnostics, /current assertion/);
    assert.doesNotMatch(error.diagnostics, /Earlier/);
    return true;
  });
  await command(process.execPath, ['-e', 'process.stdout.write("sec"); process.stdout.write("ret");'],
    { cwd: f.root, env: process.env, logFile, redactOutput: value => value.replaceAll('secret', '[redacted]') });
  assert.match(fs.readFileSync(logFile, 'utf8'), /\[redacted\]/);
  const result = await command(process.execPath, ['-e', 'console.log("stdout value"); console.error("separate stderr");'],
    { cwd: f.root, env: process.env, logFile, captureStdout: true });
  assert.equal(result.stdout.trim(), 'stdout value');
});
