import fs from 'node:fs';
import path from 'node:path';

const duration = value => Number.isFinite(value) && value >= 0 && value <= 7 * 86400000;
const outcome = value => ['passed', 'failed'].includes(value);
const names = new Set(['importer-preparation', 'installer-build', 'graceful-shutdown', 'installation', 'reopen-request']);
const unknown = () => ({ status: 'unavailable' });
const read = file => {
  if (fs.statSync(file).size > 65536) throw new Error();
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
};

export function clearInstallerTimingReports(directory, reopenFile) {
  let fresh = true;
  for (const file of [path.join(directory, 'installer-timings.json'), path.join(directory, 'installer-build-timings.json'), reopenFile]) {
    if (!file) continue;
    try { fs.unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') fresh = false; }
  }
  return fresh;
}

export function readInstallerTimings(directory, { elapsedMs = 7 * 86400000 } = {}) {
  try {
    const source = read(path.join(directory, 'installer-timings.json'));
    if (source.version !== 1 || !duration(source.elapsedMs) || source.elapsedMs > elapsedMs + 1000
      || !outcome(source.outcome) || !Array.isArray(source.stages) || source.stages.length > names.size) return unknown();
    const seen = new Set();
    const stages = source.stages.map(stage => {
      if (!names.has(stage.name) || seen.has(stage.name) || !duration(stage.elapsedMs) || !outcome(stage.outcome)) throw new Error();
      seen.add(stage.name);
      return { name: stage.name, elapsedMs: stage.elapsedMs, outcome: stage.outcome };
    });
    if (stages.reduce((sum, stage) => sum + stage.elapsedMs, 0) > source.elapsedMs + stages.length) return unknown();
    const result = { status: 'available', elapsedMs: source.elapsedMs, outcome: source.outcome, stages, build: unknown() };
    const outer = stages.find(stage => stage.name === 'installer-build');
    if (source.buildDetailFresh === true && outer) {
      try {
        const build = read(path.join(directory, 'installer-build-timings.json'));
        if (build.version !== 1 || !duration(build.elapsedMs) || build.elapsedMs > outer.elapsedMs + 1000 || !outcome(build.outcome)
          || !['unavailable', 'tauri-built-application'].includes(build.boundary)
          || !['unavailable', 'cargo-reported-duration'].includes(build.compilationBoundary)) throw new Error();
        const keys = ['compilationMs', 'packagingMs', 'preparationMs', 'unknownMs'];
        for (const key of keys) if ((build[key] === null && key !== 'unknownMs') ? false : !duration(build[key])) throw new Error();
        if ((build.boundary === 'unavailable') !== (build.packagingMs === null)
          || (build.compilationBoundary === 'unavailable') !== (build.compilationMs === null)
          || (build.compilationMs === null) !== (build.preparationMs === null)) throw new Error();
        if (keys.reduce((sum, key) => sum + (build[key] ?? 0), 0) !== build.elapsedMs) throw new Error();
        result.build = { status: 'available', elapsedMs: build.elapsedMs, outcome: build.outcome,
          ...Object.fromEntries(keys.map(key => [key, build[key]])), boundary: build.boundary, compilationBoundary: build.compilationBoundary };
      } catch { /* Missing detail leaves the existing combined build time intact. */ }
    }
    const outsideStages = Math.max(0, source.elapsedMs - stages.reduce((sum, stage) => sum + stage.elapsedMs, 0));
    result.unassignedMs = outsideStages + (stages.find(stage => stage.name === 'reopen-request')?.elapsedMs ?? 0) + (result.build.status === 'available'
      ? Math.max(0, (outer?.elapsedMs ?? 0) - result.build.elapsedMs) + result.build.unknownMs : outer?.elapsedMs ?? 0);
    return result;
  } catch { return unknown(); }
}

export function readInstalledReopenTiming(file) {
  try {
    const source = read(file);
    if (source.version !== 1 || !duration(source.elapsedMs) || !outcome(source.outcome)
      || source.boundary !== 'process-spawn' || source.applicationReadyMeasured !== false) return unknown();
    return { status: 'available', elapsedMs: source.elapsedMs, outcome: source.outcome,
      boundary: 'process-spawn', applicationReadyMeasured: false };
  } catch { return unknown(); }
}

const formatted = value => value === null || value === undefined ? 'unknown' : value < 1000
  ? `${Math.round(value)}ms` : `${Math.round(value / 1000)}s`;

export function installerTimingLines(timing) {
  if (timing?.status !== 'available') return ['Installer timing breakdown unavailable; combined step retained.'];
  const build = timing.build;
  const stage = name => timing.stages.find(stage => stage.name === name)?.elapsedMs;
  return [
    `Installer native compilation: ${formatted(build.compilationMs)} (Cargo-reported duration)`,
    `Installer packaging / finalization: ${formatted(build.packagingMs)}`,
    `Installer build preparation: ${formatted(build.preparationMs)}`,
    `Importer preparation: ${formatted(stage('importer-preparation'))}`,
    `Graceful shutdown: ${formatted(stage('graceful-shutdown'))}; installation: ${formatted(stage('installation'))}`,
    `Installer runner overhead / unassigned time: ${formatted(timing.unassignedMs + (timing.updaterOverheadMs ?? 0))}`,
    'Installed app launch: deferred until build cleanup.',
  ];
}

export function installedReopenTimingLine(timing) {
  return timing?.status === 'available'
    ? `Installed app launch: ${formatted(timing.elapsedMs)} (${timing.outcome}; process spawn only, app readiness not measured)`
    : 'Installed app launch timing unavailable.';
}
