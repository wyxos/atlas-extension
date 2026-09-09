import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { git } from './repository.mjs';

// IDs identify immutable diff hunks, never model-authored patch text or paths.
export function changeUnits(root, base, tree) {
  const patch = execFileSync('git', ['-C', root, 'diff', '--no-ext-diff', '--no-textconv', '--no-renames',
    '--binary', '--unified=0', base, tree], { encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  let next = 0;
  return patch.split(/(?=^diff --git )/m).filter(Boolean).map((text) => {
    const start = text.search(/^@@ /m);
    const atomic = start < 0 || /^(new file|deleted file|old mode|new mode) /m.test(text);
    const header = atomic ? '' : text.slice(0, start).replace(/^index .*\n/m, '');
    const parts = atomic ? [text] : text.slice(start).split(/(?=^@@ )/m);
    return { header, units: parts.map((patch) => ({ id: `change-${++next}`, patch })) };
  });
}

export function validateCommitPlan(groups, files) {
  const remaining = new Set(files.flatMap((file) => file.units.map((unit) => unit.id)));
  if (!Array.isArray(groups)) throw new Error('Missing semantic commit plan.');
  for (const group of groups) {
    if (!group.message?.trim() || !group.reason?.trim() || !Array.isArray(group.changes) || !group.changes.length) {
      throw new Error('Each feature commit needs a subject, rationale and changes.');
    }
    for (const id of group.changes) {
      if (!remaining.delete(id)) throw new Error(`Unknown or duplicate commit change: ${id}`);
    }
  }
  if (remaining.size) throw new Error('Commit plan does not cover every working change.');
}

export function plannedCommits(root, base, files, groups) {
  validateCommitPlan(groups, files);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-commits-'));
  const env = { GIT_INDEX_FILE: path.join(directory, 'index') };
  const selected = new Set();
  const result = [];
  try {
    for (const group of groups) {
      group.changes.forEach((id) => selected.add(id));
      const patch = files.map((file) => {
        const units = file.units.filter((unit) => selected.has(unit.id));
        return units.length ? file.header + units.map((unit) => unit.patch).join('') : '';
      }).join('');
      // Reapply cumulative hunks against the original base so shared-file offsets
      // remain correct regardless of the semantic commit order.
      git(root, ['read-tree', base], env);
      execFileSync('git', ['-C', root, 'apply', '--cached', '--unidiff-zero', '--whitespace=nowarn', '-'], {
        input: patch, encoding: 'utf8', windowsHide: true, env: { ...process.env, ...env },
      });
      result.push({ tree: git(root, ['write-tree'], env), message: group.message, reason: group.reason });
    }
    return result;
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

export function publishCommits(root, base, commits) {
  let parent = base;
  for (const commit of commits) {
    parent = git(root, ['commit-tree', commit.tree, '-p', parent, '-m', commit.message.trim(), '-m', commit.reason]);
  }
  // Publish the complete series atomically; never reset or rewrite working files.
  git(root, ['update-ref', '-m', 'Atlas semantic release preparation', 'HEAD', parent, base]);
  git(root, ['read-tree', parent]);
  return parent;
}

export function versionTree(root, base, updates) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-version-tree-'));
  const env = { GIT_INDEX_FILE: path.join(directory, 'index') };
  try {
    git(root, ['read-tree', base], env);
    for (const { file, text } of updates) {
      const mode = git(root, ['ls-tree', base, '--', file]).split(' ')[0];
      const blob = execFileSync('git', ['-C', root, 'hash-object', '-w', '--path', file, '--stdin'], {
        input: text, encoding: 'utf8', windowsHide: true,
      }).trim();
      git(root, ['update-index', '--add', '--cacheinfo', mode, blob, file], env);
    }
    return git(root, ['write-tree'], env);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
