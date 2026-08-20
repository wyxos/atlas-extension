import { performanceDiagnosticsStorageKey } from '../shared/performance-diagnostics.js';

const defaultSampleLimit = 1000;

export function createPerformanceDiagnosticStore({
  sampleLimit = defaultSampleLimit,
  storageArea = globalThis.chrome?.storage?.local,
} = {}) {
  const samples = [];
  let enabled = false;

  const ready = readEnabled(storageArea).then((value) => {
    enabled = value;
  });

  function handleMessage(message, sendResponse) {
    if (message?.type === 'atlas-extension.diagnostics.record') {
      record(message.metric);
      sendResponse?.({ ok: true, payload: { recorded: enabled } });
      return false;
    }

    if (message?.type === 'atlas-extension.diagnostics.snapshot') {
      sendResponse?.({
        ok: true,
        payload: {
          enabled,
          samples: samples.map((sample) => ({ ...sample })),
        },
      });
      return false;
    }

    if (message?.type === 'atlas-extension.diagnostics.configure') {
      enabled = message.enabled === true;
      if (!enabled) {
        samples.length = 0;
      }
      void writeEnabled(storageArea, enabled);
      sendResponse?.({ ok: true, payload: { enabled } });
      return false;
    }

    return null;
  }

  function record(metric) {
    if (!enabled || !isMetric(metric)) {
      return;
    }

    samples.push({
      details: normalizeDetails(metric.details),
      durationMs: normalizeDuration(metric.durationMs),
      name: metric.name,
      recordedAt: normalizeTimestamp(metric.recordedAt),
    });
    if (samples.length > sampleLimit) {
      samples.splice(0, samples.length - sampleLimit);
    }
  }

  return {
    handleMessage,
    isEnabled: () => enabled,
    ready,
    record,
    snapshot: () => samples.map((sample) => ({ ...sample })),
  };
}

function isMetric(metric) {
  return typeof metric?.name === 'string'
    && metric.name !== ''
    && Number.isFinite(Number(metric.durationMs));
}

function normalizeDetails(details) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) {
    return {};
  }

  return Object.fromEntries(Object.entries(details).slice(0, 20));
}

function normalizeDuration(value) {
  return Math.max(0, Number(value));
}

function normalizeTimestamp(value) {
  const timestamp = Number(value);

  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Date.now();
}

async function readEnabled(storageArea) {
  if (typeof storageArea?.get !== 'function') {
    return false;
  }

  try {
    const values = await storageArea.get(performanceDiagnosticsStorageKey);
    return values?.[performanceDiagnosticsStorageKey] === true;
  } catch {
    return false;
  }
}

async function writeEnabled(storageArea, enabled) {
  try {
    await storageArea?.set?.({ [performanceDiagnosticsStorageKey]: enabled });
  } catch {
    // Diagnostics must never affect extension behavior.
  }
}
