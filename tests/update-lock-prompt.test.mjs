import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const scripts = path.resolve(import.meta.dirname, '../scripts');
const quote = (value) => `'${value.replaceAll("'", "''")}'`;

function runPrompt(t, { answer = 'y', code = 73, interactive = true, dryRun = false,
  recovered = false, processes = [], services = [], replaceLock = false, inspectionError = false,
  serviceInspectionError = false } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-lock-prompt-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const local = path.join(directory, 'local');
  const lock = path.join(local, 'AtlasBuild', 'update.lock');
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  fs.writeFileSync(lock, '123456');
  const script = path.join(directory, 'fixture.ps1');
  fs.writeFileSync(script, `
$ErrorActionPreference = 'Stop'
. ${quote(path.join(scripts, 'update-lock-prompt.ps1'))}
# A controlled process census lets the real recovery script operate only on this
# disposable lock, without depending on other builds running on the workstation.
function Get-CimInstance {
  param([string]$ClassName)
  if ($ClassName -eq 'Win32_Service') {
    if ($env:ATLAS_TEST_SERVICE_INSPECTION_ERROR -eq 'true') { throw 'Service inspection unavailable' }
    return (ConvertFrom-Json $env:ATLAS_TEST_SERVICES)
  }
  if ($env:ATLAS_TEST_INSPECTION_ERROR -eq 'true') { throw 'Inspection unavailable' }
  if ($env:ATLAS_TEST_REPLACE_LOCK -eq 'true') {
    [IO.File]::WriteAllText((Join-Path $env:LOCALAPPDATA 'AtlasBuild/update.lock'), '654321')
  }
  return (ConvertFrom-Json $env:ATLAS_TEST_PROCESSES)
}
function Get-Process { return $null }
$retry = Confirm-UpdateLockRecovery -UpdateExitCode ${code} -Interactive $${interactive} -DryRun:$${dryRun} -AlreadyRecovered:$${recovered}
Write-Host "RETRY=$retry"
`);
  const result = spawnSync('pwsh.exe', ['-NoProfile', '-File', script], {
    input: `${answer}\n`, encoding: 'utf8', windowsHide: true, timeout: 10000,
    env: { ...process.env, LOCALAPPDATA: local,
      ATLAS_TEST_PROCESSES: JSON.stringify(processes.map(entry => ({ ...entry,
        CommandLine: entry.CommandLine?.replaceAll('ATLAS_TEST_LOCAL', local) ?? null }))),
      ATLAS_TEST_SERVICES: JSON.stringify(services),
      ATLAS_TEST_SERVICE_INSPECTION_ERROR: String(serviceInspectionError),
      ATLAS_TEST_REPLACE_LOCK: String(replaceLock), ATLAS_TEST_INSPECTION_ERROR: String(inspectionError) },
  });
  assert.equal(result.error, undefined);
  return { ...result, lock, output: result.stdout + result.stderr };
}

const options = { skip: process.platform !== 'win32', timeout: 30000 };
test('interactive confirmation checks and removes a stale lock before allowing a retry', options, (t) => {
  const result = runPrompt(t);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /Recover interrupted update and retry\? \[y\/N\]/);
  assert.match(result.output, /Recovered interrupted update/);
  assert.match(result.output, /RETRY=True/);
  assert.equal(fs.existsSync(result.lock), false);
});

test('unrelated Git read operations do not prevent recovery', options, (t) => {
  for (const command of ['git.exe status --porcelain=v2',
    '"C:\\Program Files\\Git\\cmd\\git.exe" --no-optional-locks --no-pager log -1',
    'git.exe -c core.quotepath=false rev-parse --git-dir']) {
    const result = runPrompt(t, { processes: [{ ProcessId: 654321, Name: 'git.exe', CommandLine: command }] });
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /RETRY=True/);
    assert.equal(fs.existsSync(result.lock), false);
  }
});

const installerServiceProcesses = [
  { ProcessId: 20, Name: 'services.exe', SessionId: 0 },
  { ProcessId: 30, Name: 'msiexec.exe', ParentProcessId: 20, SessionId: 0, CommandLine: null },
];
const installerService = { Name: 'msiserver', ProcessId: 30, State: 'Running', StartName: 'LocalSystem',
  PathName: `${process.env.SystemRoot}\\system32\\msiexec.exe /V` };

test('an attested Windows Installer service is unrelated to Atlas NSIS installation', options, (t) => {
  const result = runPrompt(t, { processes: installerServiceProcesses, services: [installerService] });
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /RETRY=True/);
  assert.equal(fs.existsSync(result.lock), false);
});

test('unattested installers, unknown tools and mutating Git commands remain blocked', options, (t) => {
  for (const args of [
    { processes: installerServiceProcesses },
    { processes: installerServiceProcesses, services: [installerService], serviceInspectionError: true },
    { processes: installerServiceProcesses, services: [{ ...installerService, ProcessId: 31 }] },
    { processes: installerServiceProcesses, services: [{ ...installerService, PathName: 'C:\\other\\msiexec.exe /V' }] },
    { processes: installerServiceProcesses, services: [{ ...installerService, StartName: 'OtherAccount' }] },
    { processes: [{ ...installerServiceProcesses[1], SessionId: 1 }], services: [installerService] },
    { processes: [{ ProcessId: 654321, Name: 'git.exe', CommandLine: 'git.exe fetch origin' }] },
    { processes: [{ ProcessId: 654321, Name: 'git.exe', CommandLine: 'git.exe log --output=build.log' }] },
    { processes: [{ ProcessId: 654321, Name: 'git.exe', CommandLine: 'git.exe custom-command' }] },
    { processes: [{ ProcessId: 654321, Name: 'git.exe', CommandLine: null }] },
    { processes: [{ ProcessId: 654321, Name: 'cargo.exe', CommandLine: 'cargo build' }] },
  ]) {
    const result = runPrompt(t, args);
    assert.notEqual(result.status, 0, result.output);
    assert.equal(fs.readFileSync(result.lock, 'utf8'), '123456');
  }
});

test('Atlas ancestry and orphan owner children remain blocked even for read operations', options, (t) => {
  for (const processes of [
    [{ ProcessId: 654321, ParentProcessId: 123456, Name: 'git.exe', CommandLine: 'git.exe status' }],
    [{ ProcessId: 654320, Name: 'node.exe', CommandLine: 'node scripts/smart-rebuild.mjs' },
      { ProcessId: 654321, ParentProcessId: 654320, Name: 'git.exe', CommandLine: 'git.exe status' }],
    [{ ProcessId: 654322, ParentProcessId: 654321, Name: 'helper.exe', CommandLine: null },
      { ProcessId: 654321, ParentProcessId: 654320, Name: 'helper.exe', CommandLine: null },
      { ProcessId: 654320, Name: 'node.exe', CommandLine: 'node scripts/smart-rebuild.mjs' }],
    [{ ProcessId: 654321, Name: 'Atlas_2.21.1_x64-setup.exe', CommandLine: null }],
    [...installerServiceProcesses, { ProcessId: 123456 + 1, ParentProcessId: 123456, Name: 'helper.exe' },
      { ...installerServiceProcesses[1], ParentProcessId: 123456 + 1 }],
    [{ ProcessId: 654321, Name: 'git.exe', CommandLine: 'git.exe status -- ATLAS_TEST_LOCAL\\AtlasBuild\\workspaces\\run-123' }],
  ]) {
    const result = runPrompt(t, { processes });
    assert.notEqual(result.status, 0, result.output);
    assert.equal(fs.readFileSync(result.lock, 'utf8'), '123456');
  }
});

test('declining or pressing Enter leaves the lock in place', options, (t) => {
  for (const answer of ['', 'n']) {
    const result = runPrompt(t, { answer });
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /RETRY=False/);
    assert.equal(fs.readFileSync(result.lock, 'utf8'), '123456');
  }
});

test('noninteractive runs, dry runs, other errors and a second recovery attempt never prompt', options, (t) => {
  for (const args of [{ interactive: false }, { dryRun: true }, { code: 1 }, { code: 0 }, { recovered: true }]) {
    const result = runPrompt(t, args);
    assert.equal(result.status, 0, result.output);
    assert.doesNotMatch(result.output, /Recover interrupted update and retry/);
    assert.match(result.output, /RETRY=False/);
    assert.equal(fs.readFileSync(result.lock, 'utf8'), '123456');
  }
});

test('confirmation cannot override active owners, builds, missing process details or changed locks', options, (t) => {
  for (const args of [
    { processes: [{ ProcessId: 123456, Name: 'node.exe', CommandLine: 'updater' }] },
    { processes: [{ ProcessId: 654321, Name: 'cargo.exe', CommandLine: 'cargo build' }] },
    { processes: [{ ProcessId: 654321, Name: 'node.exe', CommandLine: null }] },
    { inspectionError: true }, { replaceLock: true },
  ]) {
    const result = runPrompt(t, args);
    assert.notEqual(result.status, 0, result.output);
    assert.doesNotMatch(result.output, /RETRY=True|Recovered interrupted update/);
    assert.equal(fs.readFileSync(result.lock, 'utf8'), args.replaceLock ? '654321' : '123456');
  }
});

test('the launcher retries once after confirmation and keeps updater arguments and exit codes', options, (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-lock-launcher-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.copyFileSync(path.join(scripts, 'rebuild-atlas.ps1'), path.join(directory, 'rebuild-atlas.ps1'));
  fs.writeFileSync(path.join(directory, 'update-lock-prompt.ps1'),
    fs.readFileSync(path.join(scripts, 'update-lock-prompt.ps1'), 'utf8') + `
$script:checkedRecovery = (Get-Item Function:Confirm-UpdateLockRecovery).ScriptBlock
function Confirm-UpdateLockRecovery {
  param([int]$UpdateExitCode, [switch]$DryRun, [switch]$AlreadyRecovered)
  & $script:checkedRecovery @PSBoundParameters -Interactive $true -RecoverAction { Write-Host 'RECOVERY_CHECKED' }
}
`);
  const runner = path.join(directory, 'runner.ps1');
  fs.writeFileSync(runner, `
$global:updateCalls = 0
function global:node.exe {
  $global:updateCalls += 1
  Write-Host "UPDATE_CALL=$global:updateCalls ARGS=$args"
  $global:LASTEXITCODE = if ($global:updateCalls -eq 1) { 73 } else { [int]$env:ATLAS_TEST_RETRY_CODE }
}
& ${quote(path.join(directory, 'rebuild-atlas.ps1'))} -SkipUncommitted
exit $LASTEXITCODE
`);
  for (const [answer, retryCode, expectedCalls, expectedExit] of [['y', 0, 2, 0], ['y', 73, 2, 73], ['', 0, 1, 73]]) {
    const result = spawnSync('pwsh.exe', ['-NoProfile', '-File', runner], {
      input: `${answer}\n`, encoding: 'utf8', windowsHide: true, timeout: 10000,
      env: { ...process.env, LOCALAPPDATA: path.join(directory, 'local'), ATLAS_TEST_RETRY_CODE: String(retryCode) },
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, expectedExit, result.stdout + result.stderr);
    assert.equal((result.stdout.match(/UPDATE_CALL=/g) ?? []).length, expectedCalls);
    assert.equal((result.stdout.match(/--skip-uncommitted/g) ?? []).length, expectedCalls);
    assert.equal((result.stdout.match(/Recover interrupted update and retry/g) ?? []).length, 1);
    assert.equal(result.stdout.includes('RECOVERY_CHECKED'), answer === 'y');
  }
});

test('a locked summary transcript cannot prevent the launcher recovery prompt', options, (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-transcript-lock-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (const name of ['rebuild-atlas.ps1', 'update-lock-prompt.ps1']) {
    fs.copyFileSync(path.join(scripts, name), path.join(directory, name));
  }
  fs.appendFileSync(path.join(directory, 'update-lock-prompt.ps1'), `
$script:checkedRecovery = (Get-Item Function:Confirm-UpdateLockRecovery).ScriptBlock
function Confirm-UpdateLockRecovery {
  param([int]$UpdateExitCode, [switch]$DryRun, [switch]$AlreadyRecovered)
  & $script:checkedRecovery @PSBoundParameters -Interactive $true -RecoverAction { Write-Host 'RECOVERY_CHECKED' }
}
`);
  const runner = path.join(directory, 'runner.ps1');
  fs.writeFileSync(runner, `
$ErrorActionPreference = 'Stop'
$logDirectory = Join-Path $env:LOCALAPPDATA 'AtlasBuild'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$log = Join-Path $logDirectory 'update-latest.log'
[IO.File]::WriteAllText($log, 'existing transcript')
$heldLog = [IO.File]::Open($log, 'Open', 'ReadWrite', 'None')
function global:node.exe { $global:LASTEXITCODE = 73 }
try { & ${quote(path.join(directory, 'rebuild-atlas.ps1'))} }
finally { $heldLog.Dispose() }
exit $LASTEXITCODE
`);
  const local = path.join(directory, 'local');
  const result = spawnSync('pwsh.exe', ['-NoProfile', '-File', runner], {
    input: 'y\n', encoding: 'utf8', windowsHide: true, timeout: 10000,
    env: { ...process.env, LOCALAPPDATA: local },
  });
  assert.equal(result.error, undefined);
  const output = result.stdout + result.stderr;
  assert.match(output, /RECOVERY_CHECKED/);
  assert.equal(result.status, 73, output);
  assert.doesNotMatch(output, /Transcription cannot be started|not currently transcribing/);
  assert.equal(fs.readFileSync(path.join(local, 'AtlasBuild', 'update-latest.log'), 'utf8'), 'existing transcript');
  const fallback = fs.readdirSync(path.join(local, 'AtlasBuild')).find(name => /^update-.*\.log$/.test(name) && name !== 'update-latest.log');
  assert.ok(fallback, 'the concurrent launcher must have its own transcript');
  assert.match(fs.readFileSync(path.join(local, 'AtlasBuild', fallback), 'utf8'), /RECOVERY_CHECKED/);
});
