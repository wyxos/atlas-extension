import fs from 'node:fs';

const maximumMs = 7 * 24 * 60 * 60 * 1000;
const duration = value => Number.isFinite(value) && value >= 0 && value <= maximumMs;
const outcome = value => value === 'passed' || value === 'failed';
const name = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value);
const unavailable = () => ({ status: 'unavailable' });

// Read only bounded, content-free fields. Command errors and diagnostics belong
// to the existing detail log, never this observational timing summary.
export function readRustTestTimings(file, { elapsedMs = maximumMs } = {}) {
  try {
    if (fs.statSync(file).size > 1024 * 1024) return unavailable();
    const source = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (![2, 3].includes(source.version) || !duration(source.elapsedMs) || source.elapsedMs > elapsedMs + 1000
      || !Array.isArray(source.stages) || source.stages.length > 512
      || (source.outcome !== undefined && !outcome(source.outcome))) return unavailable();
    const stages = source.stages.map(stage => {
      if (!name(stage.name) || !duration(stage.elapsedMs) || !outcome(stage.outcome)) throw new Error();
      return { name: stage.name, elapsedMs: stage.elapsedMs, outcome: stage.outcome };
    });
    if (stages.reduce((sum, stage) => sum + stage.elapsedMs, 0) > source.elapsedMs + stages.length) return unavailable();
    const common = { reportVersion: source.version, elapsedMs: source.elapsedMs,
      ...(source.outcome ? { outcome: source.outcome } : {}), stages };
    if (source.version === 2) return { status: 'legacy', ...common };
    if (!Array.isArray(source.cargoPhases) || source.cargoPhases.length > 256) return unavailable();
    const names = new Set();
    const cargoPhases = source.cargoPhases.map(phase => {
      const stage = stages.find(stage => stage.name === phase.name);
      if (!name(phase.name) || names.has(phase.name) || !stage || !outcome(phase.outcome)
        || !['build-finished', 'unavailable'].includes(phase.boundary)
        || phase.executionIncludesDoctestCompilation !== true || !duration(phase.unattributedMs)) throw new Error();
      names.add(phase.name);
      const measured = phase.boundary === 'build-finished';
      if (measured ? !duration(phase.compilationMs) || !duration(phase.executionMs)
        : phase.compilationMs !== null || phase.executionMs !== null) throw new Error();
      const total = (phase.compilationMs ?? 0) + (phase.executionMs ?? 0) + phase.unattributedMs;
      if (total > stage.elapsedMs + 2) throw new Error();
      return { name: phase.name, compilationMs: phase.compilationMs, executionMs: phase.executionMs,
        unattributedMs: phase.unattributedMs, outcome: phase.outcome, boundary: phase.boundary,
        executionIncludesDoctestCompilation: true };
    });
    // A command that failed before spawning Cargo has no phase. Its elapsed
    // outer stage remains unassigned rather than being called preparation.
    if (source.commands !== undefined) {
      if (!Array.isArray(source.commands) || source.commands.length > 256) return unavailable();
      for (const command of source.commands) {
        if (!name(command.name)) return unavailable();
        names.add(command.name);
      }
    }
    const preparationMs = stages.filter(stage => !names.has(stage.name)).reduce((sum, stage) => sum + stage.elapsedMs, 0);
    const compilationMs = cargoPhases.reduce((sum, phase) => sum + (phase.compilationMs ?? 0), 0);
    const executionMs = cargoPhases.reduce((sum, phase) => sum + (phase.executionMs ?? 0), 0);
    return { status: 'available', ...common, cargoPhases, preparationMs, compilationMs, executionMs,
      unknownMs: Math.max(0, source.elapsedMs - preparationMs - compilationMs - executionMs) };
  } catch { return unavailable(); }
}

const formatted = milliseconds => {
  const seconds = Math.round(milliseconds / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};

export function rustTestTimingLines(timing) {
  if (!timing || timing.status === 'unavailable') return ['Rust timing breakdown unavailable; see the detail log.'];
  if (timing.status === 'legacy') return ['Rust compilation/execution split unavailable for this Desktop revision; combined timings retained.'];
  const measured = timing.cargoPhases.some(phase => phase.boundary === 'build-finished');
  return [
    `Rust test compilation: ${measured ? formatted(timing.compilationMs) + ' measured' : 'unknown'}`,
    `Rust test execution: ${measured ? formatted(timing.executionMs) + ' measured' : 'unknown'} (includes doctest compilation)`,
    `Rust setup and cleanup: ${formatted(timing.preparationMs)}`,
    `Rust runner overhead / unassigned time: ${formatted(timing.unknownMs + (timing.updaterOverheadMs ?? 0))}`,
  ];
}
