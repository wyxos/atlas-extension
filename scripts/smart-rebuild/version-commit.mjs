import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { git, assertReady, replaceVersionFile, versionUpdates } from './repository.mjs';
import { mainCheckout } from './main-changes.mjs';
import { versionTree } from './commit-plan.mjs';

export function committedText(root, head, file) {
  return execFileSync('git', ['-C', root, 'show', `${head}:${file}`], {
    encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export function committedVersion(repo, head) {
  const file = repo.kind === 'desktop' ? 'src-tauri/tauri.conf.json' : 'manifest.json';
  return JSON.parse(committedText(repo.root, head, file)).version;
}

export function versionBaseline(repo, head) {
  const file = repo.kind === 'desktop' ? 'src-tauri/tauri.conf.json' : 'manifest.json';
  const version = committedVersion(repo, head);
  const candidates = git(repo.root, ['log', '--first-parent', '--diff-merges=first-parent', '--no-patch',
    '--format=%H', '-G', '"version"', head, '--', file]).split('\n').filter(Boolean);
  for (const commit of candidates) {
    if (committedVersion(repo, commit) !== version) continue;
    const parent = git(repo.root, ['rev-list', '--parents', '-n', '1', commit]).split(' ')[1];
    if (!parent || !git(repo.root, ['ls-tree', parent, '--', file]) || committedVersion(repo, parent) !== version) return commit;
  }
  throw new Error(`${repo.name}: cannot find the committed version baseline.`);
}

export function planVersionCommit(repo, source, version, reason) {
  const read = (file) => git(repo.root, ['ls-tree', source, '--', file])
    ? committedText(repo.root, source, file) : null;
  const updates = versionUpdates(repo, version, read);
  const tree = versionTree(repo.root, source, updates);
  const head = git(repo.root, ['commit-tree', tree, '-p', source,
    '-m', `chore(release): prepare ${repo.name} ${version}`, '-m', reason]);
  return { source, head, tree, version, reason, files: updates.map(({ file }) => file) };
}

function blob(root, file, text) {
  return execFileSync('git', ['-C', root, 'hash-object', '--path', file, '--stdin'], {
    input: text, encoding: 'utf8', windowsHide: true,
  }).trim();
}

// The saved plan precedes any working-file/ref writes. Recovery accepts only
// original or planned version blobs. Unrelated working edits and staging survive.
export function publishVersionCommit(repo, plan, checkpoint = () => {}) {
  const root = mainCheckout(repo.root);
  const current = git(repo.root, ['rev-parse', 'refs/heads/main']);
  if (![plan.source, plan.head].includes(current)) throw new Error(`${repo.name}: main changed during version preparation.`);
  if (!root) {
    git(repo.root, ['update-ref', '-m', 'Atlas version commit', 'refs/heads/main', plan.head, current]);
    return;
  }
  const index = path.resolve(root, git(root, ['rev-parse', '--git-path', 'index']));
  const lock = `${index}.lock`;
  fs.closeSync(fs.openSync(lock, 'wx'));
  const temporary = `${lock}.atlas-${process.pid}`;
  const env = { GIT_INDEX_FILE: temporary };
  try {
    assertReady(root);
    if (git(root, ['symbolic-ref', 'HEAD']) !== 'refs/heads/main' || git(root, ['rev-parse', 'HEAD']) !== current) {
      throw new Error(`${repo.name}: main checkout changed during version preparation.`);
    }
    fs.copyFileSync(index, temporary);
    const updates = plan.files.map((file) => {
      const original = git(root, ['rev-parse', `${plan.source}:${file}`]);
      const target = git(root, ['rev-parse', `${plan.head}:${file}`]);
      const entry = git(root, ['ls-files', '--stage', '--', file], env);
      const match = /^(100644|100755) ([a-f0-9]+) 0\t/.exec(entry);
      const location = path.join(root, file);
      if (!match || ![original, target].includes(match[2]) || !fs.existsSync(location)
        || !fs.lstatSync(location).isFile()
        || fs.realpathSync(location).toLowerCase() !== path.join(fs.realpathSync(root), file).toLowerCase()
        || ![original, target].includes(blob(root, file, fs.readFileSync(location)))) {
        throw new Error(`${repo.name}: version file has conflicting edits; commit or resolve ${file} before retrying.`);
      }
      return { file, location, original, target, mode: match[1], text: committedText(root, plan.head, file) };
    });
    // Preflight every file before replacing any of them.
    for (const update of updates) {
      const value = blob(root, update.file, fs.readFileSync(update.location));
      if (![update.original, update.target].includes(value)) throw new Error('Version file changed during preparation.');
      if (value !== update.target) replaceVersionFile(update.location, update.text);
      git(root, ['update-index', '--cacheinfo', update.mode, update.target, update.file], env);
      checkpoint('file');
    }
    for (const update of updates) {
      if (blob(root, update.file, fs.readFileSync(update.location)) !== update.target) throw new Error('Version file changed during preparation.');
    }
    fs.copyFileSync(temporary, lock);
    git(root, ['update-ref', '-m', 'Atlas version commit', 'refs/heads/main', plan.head, current]);
    checkpoint('ref');
    fs.renameSync(lock, index);
  } finally {
    fs.rmSync(temporary, { force: true });
    fs.rmSync(lock, { force: true });
  }
}
