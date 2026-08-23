export function openExtensionOptions(runtime = globalThis.chrome?.runtime) {
  if (typeof runtime?.openOptionsPage !== 'function') {
    return Promise.resolve({
      error: 'Chrome options API is unavailable.',
      ok: false,
    });
  }

  return new Promise((resolve) => {
    let settled = false;

    function finish(result) {
      if (settled) {
        return;
      }

      settled = true;
      resolve(result);
    }

    function handleOpened() {
      const error = runtime?.lastError?.message;
      finish(error ? { error, ok: false } : { ok: true });
    }

    try {
      const maybePromise = runtime.openOptionsPage(handleOpened);

      if (maybePromise && typeof maybePromise.then === 'function') {
        maybePromise.then(handleOpened).catch((error) => finish({
          error: error?.message ?? 'The options page could not be opened.',
          ok: false,
        }));
      }
    } catch (error) {
      finish({
        error: error?.message ?? 'The options page could not be opened.',
        ok: false,
      });
    }
  });
}
