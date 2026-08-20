export const performanceDiagnosticsStorageKey = 'atlasPerformanceDiagnosticsEnabled';

export function createPerformanceDiagnostics({
  clock = () => globalThis.performance?.now?.() ?? Date.now(),
  runtime = globalThis.chrome?.runtime,
  storageArea = globalThis.chrome?.storage?.local,
} = {}) {
  let enabled = false;

  const ready = readEnabled(storageArea).then((value) => {
    enabled = value;
  });

  function start() {
    return enabled ? clock() : null;
  }

  function finish(name, startedAt, details = {}) {
    if (!enabled || startedAt === null) {
      return;
    }

    runtime?.sendMessage?.({
      metric: {
        details,
        durationMs: Math.max(0, clock() - startedAt),
        name,
        recordedAt: Date.now(),
      },
      type: 'atlas-extension.diagnostics.record',
    }, () => {
      void globalThis.chrome?.runtime?.lastError;
    });
  }

  return {
    finish,
    isEnabled: () => enabled,
    ready,
    start,
  };
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
