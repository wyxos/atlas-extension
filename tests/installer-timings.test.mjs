import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { clearInstallerTimingReports, readInstallerTimings, readInstalledReopenTiming, installerTimingLines, installedReopenTimingLine } from '../scripts/smart-rebuild/installer-timings.mjs';

test('installer detail preserves command boundaries and drops content from native reports', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-installer-detail-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const report = { version: 1, elapsedMs: 100, outcome: 'passed', buildDetailFresh: true, stages: [
    { name: 'installer-build', elapsedMs: 80, outcome: 'passed' },
    { name: 'installation', elapsedMs: 10, outcome: 'passed' },
  ], diagnostics: 'private path' };
  const build = { version: 1, elapsedMs: 80, outcome: 'passed', compilationMs: 40, packagingMs: 30,
    preparationMs: 10, unknownMs: 0, boundary: 'tauri-built-application', compilationBoundary: 'cargo-reported-duration' };
  const file = path.join(directory, 'installer-timings.json'), detail = path.join(directory, 'installer-build-timings.json');
  fs.writeFileSync(file, '\uFEFF' + JSON.stringify(report));
  fs.writeFileSync(detail, JSON.stringify(build));
  const result = readInstallerTimings(directory);
  assert.equal(result.status, 'available');
  assert.equal(result.build.compilationMs, 40);
  assert.equal(result.unassignedMs, 10);
  assert.equal(JSON.stringify(result).includes('private'), false);
  assert.match(installerTimingLines(result).join('\n'), /native compilation: 40ms/);
  assert.match(installerTimingLines(result).join('\n'), /deferred until build cleanup/);
  for (const malformed of [{ ...build, compilationMs: -1 }, { ...build, elapsedMs: 1 },
    { ...build, compilationBoundary: 'unavailable' }, { ...build, packagingMs: null }]) {
    fs.writeFileSync(detail, JSON.stringify(malformed));
    assert.equal(readInstallerTimings(directory).build.status, 'unavailable');
  }
  fs.writeFileSync(file, JSON.stringify({ ...report, buildDetailFresh: false }));
  fs.writeFileSync(detail, JSON.stringify(build));
  assert.equal(readInstallerTimings(directory).build.status, 'unavailable');
  fs.writeFileSync(file, JSON.stringify({ ...report, elapsedMs: -1 }));
  assert.equal(readInstallerTimings(directory).status, 'unavailable');
  assert.equal(clearInstallerTimingReports(directory), true);
  assert.equal(readInstallerTimings(directory).status, 'unavailable');
});

test('reopen reports spawn timing without claiming app readiness and stale files are cleared', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-reopen-detail-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'installer-reopen-timings.json');
  fs.writeFileSync(file, JSON.stringify({ version: 1, elapsedMs: 25, outcome: 'passed', boundary: 'process-spawn', applicationReadyMeasured: false }));
  assert.match(installedReopenTimingLine(readInstalledReopenTiming(file)), /25ms.*readiness not measured/);
  assert.equal(clearInstallerTimingReports(directory, file), true);
  assert.equal(readInstalledReopenTiming(file).status, 'unavailable');
  fs.writeFileSync(file, '{');
  assert.equal(readInstalledReopenTiming(file).status, 'unavailable');
});
