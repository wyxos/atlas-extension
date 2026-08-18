import { desktopMessageTypes } from './desktop-contract.js';

export function requestDesktopDiagnostics(runtime = globalThis.chrome?.runtime) {
  return sendDesktopMessage({ type: desktopMessageTypes.diagnostics }, runtime);
}

export function requestDesktopReconnect(runtime = globalThis.chrome?.runtime) {
  return sendDesktopMessage({ type: desktopMessageTypes.reconnect }, runtime);
}

export function requestDesktopPairing(runtime = globalThis.chrome?.runtime) {
  return sendDesktopMessage({ type: desktopMessageTypes.pair }, runtime);
}

export function cancelDesktopPairing(runtime = globalThis.chrome?.runtime) {
  return sendDesktopMessage({ type: desktopMessageTypes.cancelPairing }, runtime);
}

export function requestDesktopUnpair(runtime = globalThis.chrome?.runtime) {
  return sendDesktopMessage({ type: desktopMessageTypes.unpair }, runtime);
}

export function requestDesktopFileOpen(fileId, runtime = globalThis.chrome?.runtime) {
  return sendDesktopMessage({ fileId, type: desktopMessageTypes.openFile }, runtime);
}

export function sendDesktopMessage(message, runtime = globalThis.chrome?.runtime) {
  if (typeof runtime?.sendMessage !== 'function') {
    return Promise.reject(new Error('Atlas extension background worker is unavailable.'));
  }

  return new Promise((resolve, reject) => {
    let settled = false;

    function finish(callback, value) {
      if (settled) {
        return;
      }

      settled = true;
      callback(value);
    }

    function handleResponse(response) {
      const runtimeError = runtime.lastError?.message;

      if (runtimeError) {
        finish(reject, new Error(runtimeError));
      } else if (response?.ok === false) {
        const error = new Error(response.error?.message ?? 'Atlas Desktop request failed.');
        Object.assign(error, response.error ?? {});
        finish(reject, error);
      } else {
        finish(resolve, response?.payload ?? {});
      }
    }

    try {
      const maybePromise = runtime.sendMessage(message, handleResponse);

      if (maybePromise && typeof maybePromise.then === 'function') {
        maybePromise.then(handleResponse).catch((error) => finish(reject, error));
      }
    } catch (error) {
      finish(reject, error);
    }
  });
}
