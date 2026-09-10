import { spawn } from 'node:child_process';
import { setInterval, clearInterval } from 'node:timers';
import fs from 'node:fs';
import path from 'node:path';
import { artifactFingerprint, git, saveState } from './repository.mjs';
import { verifyInstalledExecutable } from './installed-executable.mjs';
import { createTerminal } from './terminal.mjs';

export function removeWorkspace(parent, directory) {
  const base = fs.realpathSync(parent);
  if (path.dirname(path.resolve(directory)) !== path.resolve(base)
    || !path.basename(directory).startsWith('run-')
    || fs.lstatSync(directory).isSymbolicLink()
    || path.dirname(fs.realpathSync(directory)) !== base) {
    throw new Error('Refusing cleanup outside the build workspace directory.');
  }
  // Node removes junctions themselves without following their targets.
  fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
}

export async function command(name, args, { cwd, env, logFile, status = () => {} }) {
  const descriptor = fs.openSync(logFile, 'a');
  fs.writeSync(descriptor, `\n> ${name} ${args.join(' ')}\n`);
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(name, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let tail = '';
      const reported = new Set();
      const capture = (chunk) => {
        fs.writeSync(descriptor, chunk);
        tail = (tail + chunk.toString()).slice(-8192);
        for (const [marker, message] of [
          ['Preparing importer resources...', 'Desktop: preparing importer resources'],
          ['Requesting graceful shutdown', 'Desktop: waiting for Atlas to close'],
          ['Installing and reopening Atlas silently', 'Desktop: installing and reopening'],
        ]) {
          if (!reported.has(marker) && tail.includes(marker)) { reported.add(marker); status(message); }
        }
      };
      child.stdout.on('data', capture);
      child.stderr.on('data', capture);
      child.on('error', reject);
      child.on('close', (code, signal) => code === 0 ? resolve()
        : reject(new Error(`${name} failed (${signal ?? code}).`)));
    });
  } finally { fs.closeSync(descriptor); }
}

export function recoverPublication(destination) {
  const backup = `${destination}.atlas-previous`;
  const staging = `${destination}.atlas-next`;
  if (fs.existsSync(backup)) {
    if (!fs.existsSync(destination)) fs.renameSync(backup, destination);
    else fs.rmSync(backup, { recursive: true, force: true });
  }
  if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
}

export function publishExtension(source, destination) {
  if (!fs.existsSync(path.join(source, 'manifest.json'))) throw new Error('Extension build is missing its manifest.');
  recoverPublication(destination);
  const staging = `${destination}.atlas-next`;
  const backup = `${destination}.atlas-previous`;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, staging, { recursive: true });
  if (artifactFingerprint(source) !== artifactFingerprint(staging)) throw new Error('Extension copy verification failed.');
  if (fs.existsSync(destination)) fs.renameSync(destination, backup);
  try { fs.renameSync(staging, destination); } catch (error) {
    if (fs.existsSync(backup)) fs.renameSync(backup, destination);
    throw error;
  }
  recoverPublication(destination);
}

export async function runIsolatedUpdate({ repos, stateDirectory, dryRun = false,
  log, execute = command, buildOverride }) {
  const display = createTerminal({ log });
  log = display.line;
  const statePath = path.join(stateDirectory, 'isolated-state.json');
  const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : { schema: 1, repos: {} };
  if (state.schema !== 1 || !state.repos) throw new Error('Unknown isolated build state format.');
  // Capture both refs before building; never inspect or modify the live index.
  const plans = repos.map((repo) => {
    const head = git(repo.root, ['rev-parse', '--verify', 'refs/heads/main^{commit}']);
    const tree = git(repo.root, ['rev-parse', `${head}^{tree}`]);
    const key = path.resolve(repo.root).toLowerCase();
    const previous = state.repos[key];
    if (!dryRun && repo.kind === 'extension') recoverPublication(repo.artifact);
    const fingerprint = artifactFingerprint(repo.artifact);
    const needed = !previous || previous.tree !== tree || !fingerprint || previous.artifact !== fingerprint;
    return { ...repo, head, tree, key, needed };
  });
  log('\nATLAS UPDATE', 'blue');
  for (const repo of plans) log(`${repo.name}: ${repo.needed ? 'pending' : 'up to date'} · main ${repo.head.slice(0, 8)}`, repo.needed ? 'yellow' : 'green');
  if (dryRun) { log('Inspection complete. No source, versions, builds or installations changed.'); return plans; }
  if (!plans.some((repo) => repo.needed)) { log('Complete. Nothing outstanding.'); return plans; }
  fs.mkdirSync(stateDirectory, { recursive: true });
  const logFile = path.join(stateDirectory, `build-${Date.now()}.log`);
  fs.writeFileSync(logFile, plans.map((repo) => `${repo.name}: main ${repo.head}`).join('\n') + '\n');
  const workspaceParent = path.join(stateDirectory, 'workspaces');
  fs.mkdirSync(workspaceParent, { recursive: true });
  // The launcher lock blocks crash recovery until orphaned children are stopped.
  for (const entry of fs.readdirSync(workspaceParent)) {
    if (entry.startsWith('run-')) removeWorkspace(workspaceParent, path.join(workspaceParent, entry));
  }
  const workspace = fs.mkdtempSync(path.join(fs.realpathSync(workspaceParent), 'run-'));
  const environment = { ...process.env, EXTENSION_SOURCE: path.join(workspace, 'extension'),
    SCCACHE_DIR: path.join(stateDirectory, 'cache', 'sccache'),
    CARGO_TARGET_DIR: path.join(stateDirectory, 'cache', 'desktop-target') };
  const steps = [];
  const run = (name, args, cwd) => execute(name, args, { cwd, env: environment, logFile,
    status: (message) => display.status(message.replace(/^Desktop: /, '')) });
  const npm = (script, cwd) => {
    // A cold checkout otherwise launches a jsdom worker for nearly every CPU;
    // module transforms contend and short router tests time out before running.
    const options = script === 'test:unit' ? ' -- --maxWorkers=4' : '';
    return run('pwsh.exe', ['-NoProfile', '-Command', `& npm.cmd run ${script}${options}; exit $LASTEXITCODE`], cwd);
  };
  // Desktop always bundles the captured Extension revision, even when AE is skipped.
  const snapshots = plans.filter((repo) => repo.needed || repo.kind === 'extension');
  for (const repo of snapshots) {
    repo.snapshot = path.join(workspace, repo.kind);
    steps.push({ title: `${repo.name}: copy committed main`, action: async () => {
      await run('git', ['init', repo.snapshot], workspace);
      await run('git', ['-C', repo.snapshot, 'fetch', '--no-tags', '--depth=1', repo.root, repo.head], workspace);
      await run('git', ['-C', repo.snapshot, 'checkout', '--detach', 'FETCH_HEAD'], workspace);
      if (git(repo.snapshot, ['rev-parse', 'HEAD']) !== repo.head) throw new Error('Snapshot revision mismatch.');
    } });
    steps.push({ title: `${repo.name}: install dependencies`, action: async () => {
      const install = fs.existsSync(path.join(repo.snapshot, 'package-lock.json')) ? 'ci' : 'install';
      if (install === 'install') {
        fs.appendFileSync(logFile, `${repo.name}: resolving dependencies (no committed lockfile)\n`);
        display.status('resolving dependencies');
      }
      await run('pwsh.exe', ['-NoProfile', '-Command', `& npm.cmd ${install} --no-audit --no-fund; exit $LASTEXITCODE`], repo.snapshot);
      if (repo.kind === 'desktop') {
        fs.mkdirSync(environment.CARGO_TARGET_DIR, { recursive: true });
      }
    } });
  }
  for (const repo of plans.filter((item) => item.needed)) {
    const checks = repo.kind === 'desktop'
      ? ['lint', 'build:desktop:dev', 'test:unit', 'prepare:media-tools', 'prepare:extension:stable', 'lint:rust', 'test:rust'] : ['check'];
    const labels = { check: 'validate', lint: 'check code style', 'build:desktop:dev': 'validate frontend',
      'test:unit': 'run frontend tests', 'prepare:extension:stable': 'prepare bundled extension',
      'prepare:media-tools': 'prepare bundled media tools',
      'lint:rust': 'check Rust code', 'test:rust': 'run Rust tests' };
    for (const check of checks) steps.push({ title: `${repo.name}: ${labels[check]}`, action: () => npm(check, repo.snapshot) });
    steps.push({ title: repo.kind === 'desktop' ? 'Desktop: build installer, install and reopen' : 'Extension: build', action: async () => {
      if (buildOverride) { await buildOverride(repo, plans); return; }
      const script = repo.kind === 'desktop' ? 'rebuild-and-run-installer.ps1' : 'rebuild-unpacked-extension.ps1';
      // The installer is a launcher/controller. Its build inputs and npm cwd
      // are explicitly the captured checkout, never the live source tree.
      const scriptRoot = repo.kind === 'desktop' ? repo.root : repo.snapshot;
      const parameters = repo.kind === 'desktop' ? ['-RepositoryRoot', repo.snapshot] : [];
      await run('pwsh.exe', ['-NoProfile', '-File', path.join(scriptRoot, 'scripts', script), ...parameters], repo.snapshot);
      if (repo.kind === 'desktop') {
        if (!fs.readFileSync(logFile, 'utf8').includes('Atlas was rebuilt, installed, and reopened successfully.')) {
          throw new Error('Installer did not confirm completion (another installer may be running).');
        }
        verifyInstalledExecutable(path.join(environment.CARGO_TARGET_DIR, 'release', 'atlas-desktop.exe'), repo.artifact);
      }
    } });
    steps.push({ title: `${repo.name}: ${repo.kind === 'extension' ? 'publish and verify' : 'verify installation'}`, action: () => {
      if (repo.kind === 'extension') publishExtension(path.join(repo.snapshot, 'dist', 'atlas-extension-stable-validation'), repo.artifact);
      const fingerprint = artifactFingerprint(repo.artifact);
      if (!fingerprint) throw new Error('Expected output is missing.');
      state.repos[repo.key] = { head: repo.head, tree: repo.tree, artifact: fingerprint };
      saveState(statePath, state);
    } });
  }
  let completed = 0;
  let failure;
  try {
    for (const step of steps) {
      display.start(step.title, completed, steps.length);
      fs.appendFileSync(logFile, `\nStep ${completed + 1}/${steps.length}: ${step.title}\n`);
      const timer = setInterval(display.tick, 1000);
      try { await step.action(); } catch (error) {
        display.fail();
        throw new Error(`${step.title}: ${error.message}`, { cause: error });
      } finally { clearInterval(timer); }
      completed++;
      display.done();
    }
  } catch (error) { failure = error; }
  finally {
    log('\nCleaning temporary workspaces…', 'dim');
    try { removeWorkspace(workspaceParent, workspace); } catch (error) {
      log(`Cleanup pending: ${workspace}`);
      failure ??= error;
    }
  }
  if (failure) {
    fs.appendFileSync(logFile, `\nStopped: ${failure.message}\nOutstanding: ${steps.slice(completed).map((step) => step.title).join('; ') || 'cleanup'}\n`);
    log(`Outstanding: ${steps.length - completed} build steps${completed === steps.length ? '; cleanup needs attention' : '. Rerun to retry; completed repositories will be skipped.'}`, 'yellow');
    log(`Details: ${logFile}`);
    throw failure;
  }
  log(`Complete: ${completed}/${steps.length} steps. Temporary workspaces removed.`, 'green');
  log(`Details: ${logFile}`, 'dim');
  if (plans.some((repo) => repo.kind === 'extension' && repo.needed)) log('Outstanding: reload Atlas Extension in the browser.', 'yellow');
  else log('Nothing outstanding.');
  return plans;
}
