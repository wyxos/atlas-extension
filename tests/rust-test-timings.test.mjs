import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readRustTestTimings, rustTestTimingLines } from '../scripts/smart-rebuild/rust-test-timings.mjs';

function rustReport(overrides = {}) {
  return { version: 3, elapsedMs: 11000, outcome: 'passed', stages: [
    { name: 'mariadb-start', elapsedMs: 1000, outcome: 'passed' },
    { name: 'rust-workspace', elapsedMs: 9000, outcome: 'passed' },
  ], cargoPhases: [{ name: 'rust-workspace', compilationMs: 2000, executionMs: 6000,
    unattributedMs: 0, outcome: 'passed', boundary: 'build-finished', executionIncludesDoctestCompilation: true }], ...overrides };
}

test('Rust detail distinguishes subprocess phases, preparation and remaining overhead without diagnostics', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-rust-timing-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'timing.json');
  fs.writeFileSync(file, JSON.stringify({ ...rustReport(), commands: [{ name: 'rust-workspace', args: ['private command'] }], diagnostics: 'private error' }));
  const timing = readRustTestTimings(file);
  assert.equal(timing.preparationMs, 1000);
  assert.equal(timing.compilationMs, 2000);
  assert.equal(timing.executionMs, 6000);
  assert.equal(timing.unknownMs, 2000);
  assert.equal(timing.preparationMs + timing.compilationMs + timing.executionMs + timing.unknownMs, timing.elapsedMs);
  assert.deepEqual(readRustTestTimings(file, { elapsedMs: 10 }), { status: 'unavailable' });
  assert.equal(JSON.stringify(timing).includes('private'), false);
  assert.match(rustTestTimingLines(timing).join('\n'), /execution: 6s measured \(includes doctest compilation\)/);
});

test('legacy, unknown boundary and malformed reports never invent compilation or execution times', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-rust-timing-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'timing.json');
  const read = value => { fs.writeFileSync(file, JSON.stringify(value)); return readRustTestTimings(file); };
  assert.equal(read(rustReport({ version: 2 })).status, 'legacy');
  const phase = { ...rustReport().cargoPhases[0], compilationMs: null, executionMs: null,
    unattributedMs: 8000, boundary: 'unavailable' };
  const unknown = read(rustReport({ cargoPhases: [phase] }));
  assert.equal(unknown.unknownMs, 10000);
  assert.match(rustTestTimingLines(unknown).join('\n'), /compilation: unknown/);
  const noSpawn = read(rustReport({ cargoPhases: [], commands: [{ name: 'rust-workspace', args: ['private'] }] }));
  assert.equal(noSpawn.preparationMs, 1000);
  assert.equal(noSpawn.unknownMs, 10000);
  const failedCheckpoint = read(rustReport({ outcome: 'failed', stages: [
    { name: 'mariadb-start', elapsedMs: 1000, outcome: 'passed' },
    { name: 'rust-workspace', elapsedMs: 9000, outcome: 'failed' },
  ] }));
  assert.equal(failedCheckpoint.status, 'available');
  assert.equal(failedCheckpoint.cargoPhases[0].outcome, 'passed');
  for (const invalid of [rustReport({ elapsedMs: -1 }), rustReport({ elapsedMs: 1 }),
    rustReport({ cargoPhases: [{ ...phase, compilationMs: 500 }] }),
    rustReport({ cargoPhases: [{ ...phase, unattributedMs: 10000 }] }),
    rustReport({ stages: [{ name: 'private path /', elapsedMs: 1, outcome: 'passed' }] }),
    rustReport({ cargoPhases: [phase, phase] }), { version: 99 }]) {
    assert.deepEqual(read(invalid), { status: 'unavailable' });
  }
  fs.writeFileSync(file, '{');
  assert.deepEqual(readRustTestTimings(file), { status: 'unavailable' });
  fs.unlinkSync(file);
  assert.deepEqual(readRustTestTimings(file), { status: 'unavailable' });
});
