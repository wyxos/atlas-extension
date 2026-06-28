const manualScanMessage = { type: 'atlas-extension.manual-scan' };

export async function requestActiveTabScan({
  runtime = globalThis.chrome?.runtime,
  tabsApi = globalThis.chrome?.tabs,
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

  return sendManualScanMessage({ runtime, tabId: tab.id, tabsApi });
}

function queryActiveTab({ runtime, tabsApi }) {
  return new Promise((resolve) => {
    tabsApi.query({ active: true, currentWindow: true }, (tabs) => {
      void runtime?.lastError;
      resolve(tabs?.[0] ?? null);
    });
  });
}

function sendManualScanMessage({ runtime, tabId, tabsApi }) {
  return new Promise((resolve) => {
    tabsApi.sendMessage(tabId, manualScanMessage, (response) => {
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

      resolve({
        ok: true,
        scanned: response?.payload?.scanned === true,
      });
    });
  });
}
