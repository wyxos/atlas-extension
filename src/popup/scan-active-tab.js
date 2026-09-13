const manualScanMessage = { type: 'atlas-extension.manual-scan' };

export async function requestActiveTabScan({
  runtime = globalThis.chrome?.runtime,
  tabsApi = globalThis.chrome?.tabs,
  navigationApi = globalThis.chrome?.webNavigation,
} = {}) {
  if (typeof tabsApi?.query !== 'function') {
    return {
      error: 'Chrome tabs API is unavailable.',
      ok: false,
    };
  }

  const tab = await queryActiveTab({ runtime, tabsApi });

  if (!Number.isInteger(tab?.id)) {
    return {
      error: 'No active tab is available.',
      ok: false,
    };
  }

  if (typeof tabsApi.sendMessage !== 'function') {
    return {
      error: 'Chrome tabs API is unavailable.',
      ok: false,
    };
  }

  if (typeof navigationApi?.getAllFrames !== 'function') {
    return { ok: false, error: 'Frame scanning is unavailable. Reload the extension and page.' };
  }

  const frames = await new Promise((resolve) => {
    navigationApi.getAllFrames({ tabId: tab.id }, (items) => {
      resolve(runtime?.lastError ? null : items);
    });
  });
  if (!frames?.length) {
    return { ok: false, error: 'Could not list page frames. Reload the page and try again.' };
  }

  const results = await Promise.all(frames.map(({ frameId, documentId }) =>
    sendManualScanMessage({ runtime, tabId: tab.id, tabsApi,
      target: documentId ? { documentId } : { frameId } })));
  const failed = results.filter((result) => !result.ok);
  if (failed.length > 0) {
    return { ok: false, error: results.length === 1 ? failed[0].error
      : `Scanned ${results.length - failed.length} of ${results.length} page frames. Some frames could not be scanned. Reload the page and try again.` };
  }
  return { ok: true, scanned: true };
}

function queryActiveTab({ runtime, tabsApi }) {
  return new Promise((resolve) => {
    tabsApi.query({ active: true, currentWindow: true }, (tabs) => {
      void runtime?.lastError;
      resolve(tabs?.[0] ?? null);
    });
  });
}

function sendManualScanMessage({ runtime, tabId, tabsApi, target }) {
  return new Promise((resolve) => {
    const timeout = globalThis.setTimeout(() => resolve({
      ok: false, error: 'The page scan timed out. Try again.',
    }), 5000);
    tabsApi.sendMessage(tabId, manualScanMessage, target, (response) => {
      globalThis.clearTimeout(timeout);
      const error = runtime?.lastError?.message;

      if (error) {
        resolve({ error, ok: false });

        return;
      }

      if (response?.ok === false) {
        resolve({
          error: response.error ?? 'The page scan failed.',
          ok: false,
        });

        return;
      }

      if (response?.payload?.scanned !== true) {
        resolve({ error: 'The page did not confirm the scan. Try again.', ok: false });

        return;
      }

      resolve({
        ok: true,
        scanned: response?.payload?.scanned === true,
      });
    });
  });
}
