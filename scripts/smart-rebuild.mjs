import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runUpdate } from './smart-rebuild/workflow.mjs';
import { createReviewInput } from './smart-rebuild/review-input.mjs';

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const desktopRoot = path.resolve(extensionRoot, '..', 'atlas-desktop');
const stateDirectory = path.join(process.env.LOCALAPPDATA, 'AtlasBuild');
const statePath = path.join(stateDirectory, 'state.json');
const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--dry-run')) throw new Error('Supported option: --dry-run');
const dryRun = args.includes('--dry-run');

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, { windowsHide: true, stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (exit ${result.status ?? result.signal}).`);
  return result;
}

function findCodex() {
  if (process.env.CODEX_EXECUTABLE) return process.env.CODEX_EXECUTABLE;
  const directory = path.join(process.env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin');
  if (fs.existsSync(directory)) {
    const candidates = fs.readdirSync(directory).map((entry) => path.join(directory, entry, 'codex.exe'))
      .filter((file) => fs.existsSync(file))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    if (candidates.length) return candidates[0];
  }
  return 'codex.exe';
}

function analyze(context) {
  const { repo } = context;
  const prompt = createReviewInput(context);
  const output = path.join(stateDirectory, `codex-${repo.kind}.json`);
  const schema = path.join(stateDirectory, 'release-schema.json');
  const logPath = path.join(stateDirectory, `codex-${repo.kind}.log`);
  fs.rmSync(output, { force: true });
  fs.writeFileSync(schema, JSON.stringify({
    type: 'object', additionalProperties: false,
    required: ['proceed', 'bump', 'commitMessage', 'reason'],
    properties: {
      proceed: { type: 'boolean' }, bump: { enum: ['major', 'minor', 'patch'] },
      commitMessage: { type: 'string' }, reason: { type: 'string' },
    },
  }));
  console.log(`${repo.name}: sending captured Git evidence to Codex for commit/version review (${prompt.length} characters). Log: ${logPath}`);
  const log = fs.openSync(logPath, 'w');
  try {
    run(findCodex(), ['exec', '--ephemeral', '--sandbox', 'read-only', '-C', repo.root,
      '--output-schema', schema, '--output-last-message', output, '--color', 'never', '-'], {
      cwd: repo.root, input: prompt, encoding: 'utf8', stdio: ['pipe', log, log], timeout: 15 * 60 * 1000,
    });
  } finally {
    fs.closeSync(log);
  }
  return JSON.parse(fs.readFileSync(output, 'utf8'));
}

function acquireLock() {
  fs.mkdirSync(stateDirectory, { recursive: true });
  const lockPath = path.join(stateDirectory, 'update.lock');
  try {
    const descriptor = fs.openSync(lockPath, 'wx');
    fs.writeFileSync(descriptor, String(process.pid));
    fs.closeSync(descriptor);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const owner = Number(fs.readFileSync(lockPath, 'utf8'));
    if (!Number.isInteger(owner) || owner <= 0) throw new Error(`Inspect invalid update lock: ${lockPath}`, { cause: error });
    try {
      process.kill(owner, 0);
    } catch (processError) {
      if (processError.code !== 'ESRCH') throw processError;
      fs.unlinkSync(lockPath);
      return acquireLock();
    }
    throw new Error('An Atlas smart update is already running.', { cause: error });
  }
  return () => fs.unlinkSync(lockPath);
}

const repos = [
  { kind: 'extension', name: 'Atlas Extension', root: extensionRoot,
    artifact: path.join(extensionRoot, 'dist', 'atlas-extension-stable-validation') },
  { kind: 'desktop', name: 'Atlas Desktop', root: desktopRoot,
    artifact: path.join(process.env.LOCALAPPDATA, 'Atlas', 'atlas-desktop.exe') },
];
const releaseLock = acquireLock();
try {
  await runUpdate({
    repos, statePath, dryRun, analyze,
    check: (repo) => {
      console.log(`${repo.name}: running npm run check before committing.`);
      run('pwsh.exe', ['-NoProfile', '-Command', '& npm.cmd run check; exit $LASTEXITCODE'], { cwd: repo.root });
    },
    build: (repo) => {
      const script = repo.kind === 'extension' ? 'rebuild-unpacked-extension.ps1' : 'rebuild-and-run-installer.ps1';
      run('pwsh.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(repo.root, 'scripts', script)], {
        cwd: repo.root, env: { ...process.env, EXTENSION_SOURCE: extensionRoot },
      });
    },
  });
  console.log(dryRun ? 'Inspection complete. No Codex calls, commits, versions, builds or installations performed.'
    : 'Atlas update complete. Reload unpacked extensions in browser profiles to activate changed AE code.');
} catch (error) {
  console.error(`Atlas update stopped: ${error.message}`);
  console.error(`State and Codex logs: ${stateDirectory}`);
  process.exitCode = 1;
} finally {
  releaseLock();
}
