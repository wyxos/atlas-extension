import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { readThreadContext } from '../scripts/smart-rebuild/thread-context.mjs';

test('review includes active and archived tasks with Windows namespaced checkout paths', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-thread-test-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const root = path.join(home, 'repo');
  const rollout = path.join(home, 'rollout.jsonl');
  fs.writeFileSync(rollout, JSON.stringify({ payload: { role: 'assistant', phase: 'final_answer',
    content: [{ text: 'Verified feature outcome' }] } }) + '\n');
  const db = new DatabaseSync(path.join(home, 'state_5.sqlite'));
  db.exec('CREATE TABLE threads (id TEXT, cwd TEXT, title TEXT, archived INTEGER, rollout_path TEXT, first_user_message TEXT, updated_at INTEGER)');
  const insert = db.prepare('INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?, ?)');
  insert.run('active', path.toNamespacedPath(root), 'Active feature', 0, rollout, 'Add feature', 2);
  insert.run('archived', root, 'Archived fix', 1, rollout, 'Fix defect', 1);
  insert.run('other', home, 'Unrelated task', 0, rollout, 'Other project', 3);
  db.close();
  const context = readThreadContext(root, home);
  assert.deepEqual(context.tasks.map((task) => task.id), ['active', 'archived']);
  assert.equal(context.tasks[1].archived, true);
  assert.equal(context.tasks[0].finalAnswer, 'Verified feature outcome');
  assert.equal(context.tasks[1].request, 'Fix defect');
});

test('missing task database stops planning instead of silently omitting history', () => {
  assert.throws(() => readThreadContext(process.cwd(), path.join(os.tmpdir(), 'atlas-no-task-history')),
    /task history is unavailable/);
});
