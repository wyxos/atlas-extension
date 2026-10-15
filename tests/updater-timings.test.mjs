import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { updateTimings } from '../scripts/smart-rebuild/timings.mjs';

test('timings retain failed attempts, retries and cleanup without error contents', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-update-timing-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'report.json');
  let now = 100;
  const timings = updateTimings(file, [{ kind: 'desktop', head: 'fixture' }], { now: () => now });
  const failure = new Error('private diagnostic must not enter timing report');
  await assert.rejects(timings.stage('compile', () => { now += 20; throw failure; }), error => error === failure);
  assert.equal(await timings.stage('compile', () => { now += 30; return 17; }), 17);
  await timings.stage('cleanup', () => { now += 10; });
  timings.finish('passed');
  const report = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(report.stages, [
    { name: 'compile', startedMs: 0, elapsedMs: 20, outcome: 'failed' },
    { name: 'compile', startedMs: 20, elapsedMs: 30, outcome: 'passed' },
    { name: 'cleanup', startedMs: 50, elapsedMs: 10, outcome: 'passed' },
  ]);
  assert.equal(report.elapsedMs, 60);
  assert.equal(report.outcome, 'passed');
  assert.equal(JSON.stringify(report).includes(failure.message), false);
  assert.deepEqual(fs.readdirSync(directory), ['report.json']);
});
