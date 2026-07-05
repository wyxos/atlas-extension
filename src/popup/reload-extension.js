import { extensionReloadRequestType } from '../shared/extension-reload-messages.js';

const reloadRequestMessage = { type: extensionReloadRequestType };

export async function requestExtensionReload({
  runtime = globalThis.chrome?.runtime,
} = {}) {
  if (typeof runtime?.sendMessage !== 'function') {
    return {
      error: 'Chrome runtime API is unavailable.',
      ok: false,
    };
  }

  return new Promise((resolve) => {
    try {
      runtime.sendMessage(reloadRequestMessage, (response) => {
        const error = runtime?.lastError?.message;

        if (error) {
          resolve({ error, ok: false });

          return;
        }

        if (response?.ok === false) {
          resolve({
            error: response.error ?? 'Extension reload failed.',
            ok: false,
          });

          return;
        }

        resolve({
          ok: true,
          reloading: response?.payload?.reloading === true,
        });
      });
    } catch (error) {
      resolve({
        error: error?.message ?? 'Extension reload failed.',
        ok: false,
      });
    }
  });
}
