import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function writeLog(stateDirectory, name, kind, suffix = '') {
  fs.mkdirSync(stateDirectory, { recursive: true });
  return path.join(stateDirectory, `${name}-${kind}${suffix}.log`);
}

function outputFile(stateDirectory, name, kind, suffix = '') {
  return path.join(stateDirectory, `${name}-${kind}${suffix}.json`);
}

function fail(label, logFile, cause) {
  throw new Error(`${label} review failed. See ${logFile}`, { cause });
}

function runLogged(execute, executable, args, { prompt, logFile, extra = {} }) {
  const descriptor = fs.openSync(logFile, 'w');
  try {
    const result = execute(executable, args, {
      input: prompt, encoding: 'utf8', windowsHide: true,
      stdio: extra.stdio ?? ['pipe', descriptor, descriptor], timeout: 15 * 60 * 1000,
      ...extra,
    });
    if (result.error || result.status !== 0) return { ok: false, result };
    return { ok: true, result };
  } finally { fs.closeSync(descriptor); }
}

function redirectedCursorAgents(home, exists) {
  const packages = path.join(home, 'AppData', 'Local', 'Packages');
  if (!home || !exists(packages)) return [];
  let names;
  try { names = fs.readdirSync(packages); } catch { return []; }
  const found = [];
  for (const name of names) {
    if (!name.startsWith('OpenAI.Codex_')) continue;
    found.push(path.join(packages, name, 'LocalCache', 'Local', 'cursor-agent', 'agent.cmd'));
    found.push(path.join(packages, name, 'LocalCache', 'Local', 'cursor-agent', 'cursor-agent.cmd'));
  }
  return found;
}

export function resolveCursorAgent({ env = process.env, exists = fs.existsSync } = {}) {
  if (env.CURSOR_AGENT_EXECUTABLE) return { executable: env.CURSOR_AGENT_EXECUTABLE };
  const local = env.LOCALAPPDATA ?? '';
  const home = env.USERPROFILE ?? env.HOME ?? '';
  const profileLocal = path.join(home, 'AppData', 'Local');
  const candidates = [
    path.join(local, 'cursor-agent', 'agent.cmd'),
    path.join(local, 'cursor-agent', 'cursor-agent.cmd'),
    path.join(profileLocal, 'cursor-agent', 'agent.cmd'),
    path.join(profileLocal, 'cursor-agent', 'cursor-agent.cmd'),
    ...redirectedCursorAgents(home, exists),
    path.join(home, '.local', 'bin', 'agent.exe'),
    path.join(home, '.local', 'bin', 'agent.cmd'),
    path.join(home, '.local', 'bin', 'agent'),
  ];
  return { executable: candidates.find((candidate) => exists(candidate)) ?? 'agent' };
}

let appLocation;

// Windows keeps the Codex desktop app in a versioned package folder.
function codexAppLocation() {
  if (process.platform !== 'win32') return null;
  if (appLocation !== undefined) return appLocation;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    "(Get-AppxPackage -Name 'OpenAI.Codex' | Sort-Object Version -Descending | Select-Object -First 1).InstallLocation"],
  { encoding: 'utf8', windowsHide: true, timeout: 30 * 1000 });
  appLocation = result.status === 0 ? result.stdout.trim() || null : null;
  return appLocation;
}

// Prefer the CLI bundled with the Codex desktop app: it updates with the app
// and supports the models the app configures. A global npm CLI can fall behind.
export function resolveCodex({ env = process.env, exists = fs.existsSync, locate = codexAppLocation } = {}) {
  if (env.CODEX_EXECUTABLE) return env.CODEX_EXECUTABLE;
  const location = locate();
  const bundled = location ? path.join(location, 'app', 'resources', 'codex.exe') : null;
  if (bundled && exists(bundled)) return bundled;
  const vendor = path.join(env.APPDATA ?? '', 'npm', 'node_modules', '@openai', 'codex',
    'node_modules', '@openai', 'codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe');
  return exists(vendor) ? vendor : 'codex.exe';
}

function isWindowsCmd(executable) {
  return process.platform === 'win32' && /\.(cmd|bat)$/i.test(executable);
}

function cursorCommand(executable, reviewArgs, env = process.env) {
  if (!isWindowsCmd(executable)) return { executable, args: reviewArgs };
  return {
    executable: env.ComSpec || 'cmd.exe',
    args: ['/d', '/s', '/c', executable, ...reviewArgs],
  };
}

function isDesktopEditorOutput(text) {
  return /Run with 'cursor -' to read output from another program/.test(text)
    || /still passed to Electron\/Chromium/.test(text);
}

function reviewDetail(result) {
  return String(result?.stderr || result?.error?.message || '').trim().split(/\r?\n/).find(Boolean) || '';
}

export function parseCursorDecision(stdout) {
  const lines = String(stdout ?? '').trim().split(/\r?\n/).filter(Boolean);
  let value;
  for (const line of [...lines].reverse()) {
    try { value = JSON.parse(line); break; } catch { /* keep scanning for the envelope */ }
  }
  if (value === undefined) {
    try { value = JSON.parse(String(stdout ?? '').trim()); }
    catch { value = stdout; }
  }
  if (value && typeof value === 'object' && value.is_error === true) {
    throw new Error(typeof value.result === 'string' && value.result.trim() ? value.result : 'Cursor review failed.');
  }
  const payload = value && typeof value === 'object' && 'result' in value ? value.result : value;
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) return payload;
  const raw = String(payload ?? '');
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const json = (fenced ? fenced[1] : raw).match(/\{[\s\S]*\}/);
  if (!json) throw new Error('Cursor review returned no JSON decision.');
  return JSON.parse(json[0]);
}

// Shared input-only CLI transport; the controller validates and applies decisions.
export function codexReview({ repo, stateDirectory, name, schema, prompt, execute = spawnSync, executable = resolveCodex() }) {
  const schemaFile = path.join(stateDirectory, `${name}-schema.json`);
  const output = outputFile(stateDirectory, name, repo.kind);
  const logFile = writeLog(stateDirectory, name, repo.kind);
  fs.writeFileSync(schemaFile, JSON.stringify(schema));
  fs.rmSync(output, { force: true });
  const ran = runLogged(execute, executable, ['exec', '--ephemeral', '--sandbox', 'read-only', '-C', repo.root,
    '--output-schema', schemaFile, '--output-last-message', output, '--color', 'never', '-'], { prompt, logFile });
  if (!ran.ok) fail('Codex', logFile, ran.result.error);
  return JSON.parse(fs.readFileSync(output, 'utf8'));
}

export function cursorReview({ repo, stateDirectory, name, schema, prompt, execute = spawnSync,
  env = process.env, exists = fs.existsSync }) {
  const output = outputFile(stateDirectory, name, repo.kind, '-cursor');
  const logFile = writeLog(stateDirectory, name, repo.kind, '-cursor');
  fs.rmSync(output, { force: true });
  const invocation = resolveCursorAgent({ env, exists });
  const cursorPrompt = `${prompt}\nReturn JSON only, matching this schema:\n${JSON.stringify(schema)}`;
  const reviewArgs = ['-p', '--mode', 'ask', '--trust',
    '--sandbox', process.platform === 'win32' ? 'disabled' : 'enabled',
    '--model', env.CURSOR_AGENT_MODEL || 'auto',
    '--output-format', 'json', '--workspace', repo.root];
  const command = cursorCommand(invocation.executable, reviewArgs, env);
  const ran = runLogged(execute, command.executable, command.args, {
    prompt: cursorPrompt, logFile, extra: { stdio: ['pipe', 'pipe', 'pipe'] },
  });
  const stdout = ran.result.stdout ?? '';
  const stderr = ran.result.stderr ?? '';
  fs.appendFileSync(logFile, `${stderr}${stdout}`);
  fs.writeFileSync(output, stdout);
  if (isDesktopEditorOutput(`${stderr}${stdout}`)) {
    throw new Error('Cursor review launched the desktop editor instead of the Agent CLI.');
  }
  if (ran.result.error?.code === 'ENOENT') {
    throw new Error("Cursor Agent CLI is not installed. In PowerShell run: irm 'https://cursor.com/install?win32=true' | iex");
  }
  if (!ran.ok) {
    const detail = reviewDetail(ran.result);
    throw new Error(detail ? `Cursor review failed: ${detail} See ${logFile}` : `Cursor review failed. See ${logFile}`,
      { cause: ran.result.error });
  }
  return parseCursorDecision(stdout);
}

export function cliReview({ log, cursorExecute, ...options }) {
  const execute = options.execute;
  try {
    return codexReview(options);
  } catch (error) {
    if (!String(error.message ?? '').includes('Codex review failed')) throw error;
    log?.(`${options.repo.name}: Codex unavailable; reviewing via Cursor…`, 'blue');
    try {
      return cursorReview({ ...options, execute: cursorExecute ?? execute });
    } catch (cursorError) {
      throw new Error(`${cursorError.message} Codex already failed.`, { cause: cursorError });
    }
  }
}
