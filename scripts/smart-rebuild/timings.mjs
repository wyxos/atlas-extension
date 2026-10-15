import { performance } from 'node:perf_hooks';
import { saveState } from './repository.mjs';

// Content-free timings survive disposal of the captured build checkout.
export function updateTimings(file, revisions, { now = () => performance.now() } = {}) {
  const started = now();
  const report = { version: 1, startedAt: new Date().toISOString(), revisions, stages: [] };
  const save = () => saveState(file, report);
  return {
    async stage(name, action) {
      const start = now();
      let outcome = 'passed';
      let primaryError;
      let result;
      try { result = await action(); }
      catch (error) { primaryError = error; outcome = 'failed'; }
      report.stages.push({ name, startedMs: Math.max(0, Math.round(start - started)),
        elapsedMs: Math.max(0, Math.round(now() - start)), outcome });
      try { save(); } catch {
        report.reportingFailure = 'write-failed';
        if (outcome !== 'failed') throw new Error('Updater timing report could not be saved.');
      }
      if (outcome === 'failed') throw primaryError;
      return result;
    },
    finish(outcome) {
      report.outcome = outcome;
      report.elapsedMs = Math.max(0, Math.round(now() - started));
      try { save(); } catch {
        if (outcome !== 'failed') throw new Error('Updater timing report could not be saved.');
      }
      return report;
    },
  };
}
