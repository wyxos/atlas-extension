import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function readThreadContext(root, home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex')) {
  const database = path.join(home, 'state_5.sqlite');
  if (!fs.existsSync(database)) throw new Error('Codex task history is unavailable; cannot plan feature commits.');
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    const normalize = (value) => path.resolve(value).replaceAll('\\', '/').replace(/^\/\/\?\//, '').toLowerCase();
    const rows = db.prepare('SELECT id, cwd, title, archived, rollout_path, first_user_message FROM threads ORDER BY updated_at DESC').all();
    const matching = rows.filter((row) => normalize(row.cwd) === normalize(root));
    const selected = [0, 1].flatMap((archived) => matching.filter((row) => Number(row.archived) === archived).slice(0, 40));
    return { coverage: 'Up to 40 recent active and 40 archived tasks for this checkout; bounded final-answer excerpts. Git diff is authoritative.',
      tasks: selected.map((row) => {
        let finalAnswer = '';
        if (fs.existsSync(row.rollout_path)) {
          const fd = fs.openSync(row.rollout_path, 'r');
          try {
            const size = fs.fstatSync(fd).size;
            const buffer = Buffer.alloc(Math.min(size, 512 * 1024));
            fs.readSync(fd, buffer, 0, buffer.length, size - buffer.length);
            for (const line of buffer.toString('utf8').split('\n')) {
              try {
                const item = JSON.parse(line).payload;
                if (item?.role === 'assistant' && item.phase === 'final_answer') {
                  finalAnswer = (item.content ?? []).map((part) => part.text ?? '').join('\n').slice(0, 4000);
                }
              } catch { /* The bounded tail can start inside a JSON line. */ }
            }
          } finally { fs.closeSync(fd); }
        }
        return { id: row.id, title: row.title, archived: Boolean(row.archived),
          request: (row.first_user_message ?? '').slice(0, 4000), finalAnswer };
      }) };
  } finally { db.close(); }
}
