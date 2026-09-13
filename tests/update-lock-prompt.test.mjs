import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const scripts = path.resolve(import.meta.dirname, '../scripts');
const quote = (value) => `'${value.replaceAll("'", "''")}'`;

function runPrompt(t, { answer = 'y', code = 73, interactive = true, dryRun = false,
  recovered = false, processes = [], replaceLock = false, inspectionError = false } = {}) {
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
      ATLAS_TEST_PROCESSES: JSON.stringify(processes),
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
