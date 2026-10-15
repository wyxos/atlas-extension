import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { git } from './repository.mjs';

// One supervised process owns the entire batch, including every Git child.
// Re-entering runtime:external for each short Git operation dominates copying.
export async function runCapturedSnapshots(plans, workspace, run) {
  if (!plans.length) return;
  await run(process.execPath, [fileURLToPath(import.meta.url), workspace, JSON.stringify(plans)], workspace);
}

export function createCapturedSnapshots(plans, workspace, report = () => {}) {
  const base = fs.realpathSync(workspace);
  if (!Array.isArray(plans) || plans.length > 64) throw new Error('Invalid snapshot batch.');
  const destinations = new Set();
  // Reject malformed plans before creating any repository. Destinations must be
  // fresh and inside the scope-owned workspace, never existing Git worktrees.
  for (const plan of plans) {
    const { source, snapshot, head, id } = plan;
    if (typeof source !== 'string' || !path.isAbsolute(source)
      || typeof snapshot !== 'string' || !path.isAbsolute(snapshot)
      || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(head)
      || !/^[a-z][a-z0-9-]*$/.test(id)) throw new Error('Invalid captured snapshot plan.');
    const relative = path.relative(base, snapshot);
    if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)
      || destinations.has(path.resolve(snapshot).toLowerCase()) || fs.existsSync(snapshot)) {
      throw new Error('Snapshot destination is not a fresh workspace path.');
    }
    let ancestor = path.dirname(snapshot);
    while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
    const resolved = path.relative(base, fs.realpathSync(ancestor));
    if (resolved === '..' || resolved.startsWith(`..${path.sep}`) || path.isAbsolute(resolved)) {
      throw new Error('Snapshot destination escapes the workspace.');
    }
    destinations.add(path.resolve(snapshot).toLowerCase());
  }
  for (const { source, snapshot, head, id } of plans) {
    let stage = 'initialize';
    try {
      report(`Snapshot ${id}: initialize`);
      git(base, ['init', snapshot]);
      stage = 'fetch';
      // A fetch transfers objects into an independent object store; unlike a
      // local clone, it creates neither hardlinks nor shared Git metadata.
      git(base, ['-C', snapshot, 'fetch', '--no-tags', '--depth=1', source, head]);
      stage = 'checkout';
      git(snapshot, ['checkout', '--detach', 'FETCH_HEAD']);
      stage = 'verify';
      if (git(snapshot, ['rev-parse', 'HEAD']) !== head) throw new Error('Snapshot revision mismatch.');
      report(`Snapshot ${id}: verified`);
    } catch (error) {
      throw new Error(`Snapshot ${id} failed during ${stage}: ${error.message}`, { cause: error });
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { createCapturedSnapshots(JSON.parse(process.argv[3]), process.argv[2], console.log); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
