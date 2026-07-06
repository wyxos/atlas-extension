import {
  loadNextTabsDefaultLimit,
  loadNextTabsRequestType,
  normalizeLoadNextTabsLimit,
} from '../shared/load-next-tabs-messages.js';

export async function requestNextTabsLoad({
  limit = loadNextTabsDefaultLimit,
  runtime = globalThis.chrome?.runtime,
  tabsApi = globalThis.chrome?.tabs,
} = {}) {
  if (typeof tabsApi?.query !== 'function') {
    return {
      error: 'Chrome tabs API is unavailable.',
      ok: false,
    };
  }

  if (typeof runtime?.sendMessage !== 'function') {
    return {
      error: 'Chrome runtime API is unavailable.',
      ok: false,
    };
  }

  const tab = await queryActiveTab({ runtime, tabsApi });

  if (!Number.isInteger(tab?.id) || !Number.isInteger(tab?.windowId)) {
    return {
      error: 'No active tab is available.',
      ok: false,
    };
  }

  return sendLoadNextTabsRequest({
    activeTabId: tab.id,
    limit: normalizeLoadNextTabsLimit(limit),
    runtime,
    windowId: tab.windowId,
  });
}

function queryActiveTab({ runtime, tabsApi }) {
  return new Promise((resolve) => {
    tabsApi.query({ active: true, currentWindow: true }, (tabs) => {
      void runtime?.lastError;
      resolve(tabs?.[0] ?? null);
    });
  });
}

function sendLoadNextTabsRequest({
  activeTabId,
  limit,
  runtime,
  windowId,
}) {
  return new Promise((resolve) => {
    runtime.sendMessage({
      activeTabId,
      limit,
      type: loadNextTabsRequestType,
      windowId,
    }, (response) => {
      const error = runtime?.lastError?.message;

      if (error) {
        resolve({ error, ok: false });

        return;
      }

      if (response?.ok === false) {
        resolve({
          error: response.error ?? 'The tabs could not be loaded.',
          ok: false,
        });

        return;
      }

      resolve({
        activated: Number(response?.payload?.activated) || 0,
        ok: true,
        reloaded: Number(response?.payload?.reloaded) || 0,
        restored: response?.payload?.restored === true,
      });
    });
  });
}
