import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function git(root, args, env = {}) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
  }).trimEnd();
}

// A temporary index captures tracked, untracked and deleted files without
// disturbing the user's staging area. Git handles line endings and file modes.
export function snapshot(root) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-index-'));
  try {
    const env = { GIT_INDEX_FILE: path.join(temporary, 'index') };
    git(root, ['read-tree', 'HEAD'], env);
    git(root, ['add', '-A', '--', '.'], env);
    return {
      head: git(root, ['rev-parse', 'HEAD']),
      tree: git(root, ['write-tree'], env),
      status: git(root, ['status', '--porcelain=v1', '--untracked-files=all']),
      index: git(root, ['write-tree']),
    };
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

export function assertSnapshot(root, expected) {
  if (JSON.stringify(snapshot(root)) !== JSON.stringify(expected)) {
    throw new Error(`${root}: source or staging changed during the update. Rerun after edits finish.`);
  }
}

export function assertReady(root) {
  // Resolve Windows short paths and directory aliases before comparing roots.
  if (fs.realpathSync.native(git(root, ['rev-parse', '--show-toplevel'])) !== fs.realpathSync.native(root)) {
    throw new Error(`Expected an independent repository at ${root}.`);
  }
  git(root, ['symbolic-ref', '--quiet', 'HEAD']);
  if (git(root, ['ls-files', '--unmerged'])) throw new Error(`${root}: resolve merge conflicts first.`);
  for (const marker of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply']) {
    const location = git(root, ['rev-parse', '--git-path', marker]);
    if (fs.existsSync(path.resolve(root, location))) throw new Error(`${root}: finish the active Git operation first.`);
  }
}

export function readVersion(repo) {
  const file = repo.kind === 'desktop' ? 'src-tauri/tauri.conf.json' : 'manifest.json';
  return JSON.parse(fs.readFileSync(path.join(repo.root, file), 'utf8')).version;
}

export function compareVersions(a, b) {
  for (const value of [a, b]) {
    if (!/^\d+\.\d+\.\d+$/.test(value)) throw new Error(`Unsupported version: ${value}`);
  }
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return Math.sign(left[i] - right[i]);
  return 0;
}

export function bumpVersion(version, bump) {
  compareVersions(version, version);
  const numbers = version.split('.').map(Number);
  const index = ['major', 'minor', 'patch'].indexOf(bump);
  if (index < 0) throw new Error(`Invalid Codex bump: ${bump}`);
  numbers[index]++;
  for (let i = index + 1; i < 3; i++) numbers[i] = 0;
  if (numbers.some((n) => n > 65535)) throw new Error('Version exceeds browser/installer limits.');
  return numbers.join('.');
}

export function replaceVersionFile(target, text) {
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, text, { flag: 'wx', mode: fs.statSync(target).mode });
    // Windows cannot replace files while a compiler/indexer has them mapped.
    // Keep the original intact and allow short-lived handles to close.
    for (let attempt = 0; ; attempt++) {
      try {
        fs.renameSync(temporary, target);
        return;
      } catch (error) {
        if (attempt >= 20 || !['UNKNOWN', 'EPERM', 'EACCES', 'EBUSY'].includes(error.code)) {
          throw new Error(`Cannot replace ${target} (${error.code}); close processes holding the file and retry.`, { cause: error });
        }
        globalThis.Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
      }
    }
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

export function versionUpdates(repo, version, read = (file) => {
  const target = path.join(repo.root, file);
  return fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
}) {
  const jsonFiles = ['package.json', 'package-lock.json',
    repo.kind === 'desktop' ? 'src-tauri/tauri.conf.json' : 'manifest.json'];
  const updates = [];
  for (const file of jsonFiles) {
    const target = path.join(repo.root, file);
    const text = read(file);
    if (text === null && file === 'package-lock.json') continue;
    const data = JSON.parse(text);
    data.version = version;
    if (file === 'package-lock.json' && data.packages?.['']) data.packages[''].version = version;
    const newline = text.includes('\r\n') ? '\r\n' : '\n';
    updates.push([target, `${JSON.stringify(data, null, 2)}\n`.replaceAll('\n', newline)]);
  }
  if (repo.kind === 'desktop') {
    for (const file of ['src-tauri/Cargo.toml', 'src-tauri/Cargo.lock']) {
      const target = path.join(repo.root, file);
      const text = read(file);
      const pattern = /(\[\[?package\]?\][\s\S]*?\bname = "atlas-desktop"\r?\nversion = ")[^"]+("\r?\n)/;
      if (!pattern.test(text)) throw new Error(`Cannot locate Atlas package version in ${file}.`);
      updates.push([target, text.replace(pattern, (_, before, after) => `${before}${version}${after}`)]);
    }
  }
  return updates.map(([target, text]) => ({ file: path.relative(repo.root, target).replaceAll('\\', '/'), text }));
}

export function updateVersions(repo, version) {
  const updates = versionUpdates(repo, version).map(({ file, text }) => [path.join(repo.root, file), text]);
  const originals = new Map(updates.map(([target]) => [target, fs.readFileSync(target)]));
  const replaced = [];
  try {
    for (const [target, text] of updates) {
      replaceVersionFile(target, text);
      replaced.push(target);
    }
  } catch (error) {
    const failures = [error];
    for (const target of replaced.reverse()) {
      try { replaceVersionFile(target, originals.get(target)); }
      catch (rollbackError) { failures.push(rollbackError); }
    }
    if (failures.length > 1) {
      throw new AggregateError(failures, `Version update and rollback failed: ${failures.map((failure) => failure.message).join('; ')}`, { cause: error });
    }
    throw error;
  }
  return updates.map(([target, text]) => ({ file: path.relative(repo.root, target).replaceAll('\\', '/'), text }));
}

export function releaseBase(repo, currentVersion) {
  const tag = `v${currentVersion}`;
  if (git(repo.root, ['tag', '--merged', 'HEAD', '--list', tag])) return tag;
  const file = repo.kind === 'desktop' ? 'src-tauri/tauri.conf.json' : 'manifest.json';
  return git(repo.root, ['log', '-1', '--format=%H', '-G', '"version"', '--', file]);
}

export function artifactFingerprint(location) {
  if (!fs.existsSync(location)) return null;
  const hash = createHash('sha256');
  let count = 0;
  function visit(file) {
    if (fs.statSync(file).isDirectory()) {
      for (const entry of fs.readdirSync(file).sort()) visit(path.join(file, entry));
    } else {
      hash.update(path.relative(location, file));
      hash.update('\0');
      hash.update(fs.readFileSync(file));
      count++;
    }
  }
  visit(location);
  return count ? hash.digest('hex') : null;
}

export function saveState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`);
  fs.renameSync(temporary, file);
}
