import fs from 'node:fs';
import path from 'node:path';
import { git } from './repository.mjs';

function text(repo, file) {
  const location = path.join(repo.snapshot, file);
  return fs.existsSync(location) ? fs.readFileSync(location, 'utf8') : null;
}

function cargoManifests(repo) {
  return repo.kind === 'desktop'
    ? git(repo.snapshot, ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', '**/Cargo.toml', 'Cargo.toml'])
      .split('\0').filter(Boolean).sort().map(file => [file, text(repo, file)]) : [];
}

export async function cargoWorkspaceManifests(repo, locate) {
  const manifests = cargoManifests(repo).filter(([, value]) => value !== null);
  const snapshot = fs.realpathSync(repo.snapshot);
  const roots = new Set();
  for (const [manifest] of manifests) {
    // Cargo owns package.workspace redirects and excluded standalone packages;
    // parsing [workspace] headers alone cannot identify every independent lock.
    const result = await locate(manifest);
    // The managed runtime emits a startup line before Cargo's JSON. Read the
    // machine result from its own line rather than parsing the whole transcript.
    let root;
    for (const line of String(result?.stdout ?? '').trim().split(/\r?\n/).reverse()) {
      try {
        const value = JSON.parse(line);
        if (typeof value?.root === 'string') { root = value.root; break; }
      } catch { /* Runtime banners and ordinary diagnostic lines are not JSON. */ }
    }
    if (typeof root !== 'string') throw new Error('Cargo did not report a workspace manifest.');
    const relative = path.relative(snapshot, fs.realpathSync(root));
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error('Cargo workspace escaped the isolated checkout.');
    }
    roots.add(relative.replaceAll(path.sep, '/'));
  }
  return [...roots].sort();
}

export function captureRepairContract(repo) {
  const packageText = text(repo, 'package.json');
  const manifest = text(repo, repo.kind === 'desktop' ? 'src-tauri/tauri.conf.json' : 'manifest.json');
  const pkg = packageText ? JSON.parse(packageText) : null;
  const cargo = cargoManifests(repo);
  return {
    packageText, lock: text(repo, 'package-lock.json'),
    version: pkg?.version, scripts: JSON.stringify(pkg?.scripts),
    manifestVersion: manifest ? JSON.parse(manifest).version : null,
    cargoVersion: text(repo, 'src-tauri/Cargo.toml')?.match(/\bname = "atlas-desktop"\r?\nversion = "([^"]+)"/)?.[1],
    cargoLockVersion: text(repo, 'src-tauri/Cargo.lock')?.match(/\bname = "atlas-desktop"\r?\nversion = "([^"]+)"/)?.[1],
    cargoManifests: JSON.stringify(cargo),
    providerResolver: text(repo, 'scripts/provider-test-sources.mjs'),
  };
}

export function assertRepairContract(repo, original) {
  const current = captureRepairContract(repo);
  if (current.version !== original.version || current.manifestVersion !== original.manifestVersion
    || current.cargoVersion !== original.cargoVersion || current.cargoLockVersion !== original.cargoLockVersion) {
    throw new Error('Automatic repair changed release versions.');
  }
  if (current.scripts !== original.scripts) throw new Error('Automatic repair changed validation commands.');
  // Provider fixtures are frozen before checks. Changing their resolver would
  // validate against stale dependencies, so such fixes need a fresh update.
  if (current.providerResolver !== original.providerResolver) throw new Error('Automatic repair changed provider fixture definitions.');
  return { npm: current.packageText !== original.packageText || current.lock !== original.lock,
    cargo: current.cargoManifests !== original.cargoManifests };
}

export function canRepairFailure(error) {
  if (!(error.exitCode > 0) || error.signal) return false;
  // sccache's own error/fatal prefix identifies compiler-cache infrastructure
  // failures (including Windows socket buffer exhaustion, os error 10055).
  // Ordinary compiler output and a successful cache fallback remain repairable.
  if (/^\s*sccache(?:\.exe)?:\s*(?:error|fatal):/mi.test(error.diagnostics ?? '')) return false;
  // A supervised child spawn can become an outer exit(1). Match Node's spawn
  // failure prefix, preserving repairable ENOENT assertions about source files.
  if (/^\s*spawn(?:Sync)?\s+.+\s+(?:ENOENT|EACCES|EPERM)\b/mi.test(error.diagnostics ?? '')) return false;
  // Fixed supervisor/environment categories are not source-code failures.
  return !/^(?:Atlas (?:runtime interrupted\.|build stopped: disk capacity|requires a Git checkout|runtime containment requires|update.*queued)|Build storage ownership could not be verified\.|Updater build scope cleanup failed\.|.*(?:ENOSPC|npm error code E(?:AI_AGAIN|CONNRESET|CONNREFUSED|ACCES)))/mi
    .test(error.diagnostics ?? '');
}
