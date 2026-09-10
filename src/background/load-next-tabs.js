import {
  loadNextTabsDefaultLimit,
  normalizeLoadNextTabsLimit,
} from '../shared/load-next-tabs-messages.js';

export async function loadNextTabsFromActive({
  activeTabId = null,
  limit = loadNextTabsDefaultLimit,
  runtime = globalThis.chrome?.runtime,
  tabsApi = globalThis.chrome?.tabs,
  windowId = null,
} = {}) {
  if (
    typeof tabsApi?.query !== 'function'
    || typeof tabsApi?.reload !== 'function'
  ) {
    throw new Error('Chrome tabs API is unavailable.');
  }

  const normalizedLimit = normalizeLoadNextTabsLimit(limit);
  const tabs = await queryTabs({ runtime, tabsApi, windowId });
  const activeTab = findActiveTab(tabs, activeTabId);

  if (!Number.isInteger(activeTab?.id) || !Number.isInteger(activeTab?.index)) {
    throw new Error('No active tab is available.');
  }

  const tabsToLoad = tabs
    .filter((tab) => Number.isInteger(tab?.id) && Number.isInteger(tab?.index))
    .filter((tab) => tab.id !== activeTab.id && tab.index > activeTab.index)
    .sort((left, right) => left.index - right.index)
    .slice(0, normalizedLimit);

  const loadedTabIds = [];
  let failed = 0;
  for (const tab of tabsToLoad) {
    try {
      await reloadTab({ runtime, tabId: tab.id, tabsApi });
      loadedTabIds.push(tab.id);
    } catch {
      failed += 1;
    }
  }
  if (failed > 0) {
    throw new Error(`Reloaded ${loadedTabIds.length} tabs; ${failed} tabs could not be reloaded. Try again.`);
  }
  return { activated: 0, limit: normalizedLimit, reloaded: loadedTabIds.length, restored: false, tabIds: loadedTabIds };
}

function queryTabs({ runtime, tabsApi, windowId }) {
  const query = Number.isInteger(windowId) ? { windowId } : { currentWindow: true };

  return new Promise((resolve, reject) => {
    tabsApi.query(query, (tabs) => {
      const error = runtime?.lastError?.message;

      if (error) {
        reject(new Error(error));

        return;
      }

      resolve(Array.isArray(tabs) ? tabs : []);
    });
  });
}

function reloadTab({ runtime, tabId, tabsApi }) {
  if (!Number.isInteger(tabId) || typeof tabsApi?.reload !== 'function') {
    return Promise.resolve(0);
  }

  return new Promise((resolve, reject) => {
    const callback = () => {
      const error = runtime?.lastError?.message;

      if (error) {
        reject(new Error(error));

        return;
      }

      resolve(1);
    };

    if (tabsApi.reload.length >= 3) {
      tabsApi.reload(tabId, {}, callback);

      return;
    }

    tabsApi.reload(tabId, callback);
  });
}

function findActiveTab(tabs, activeTabId) {
  const normalizedActiveTabId = activeTabId === null ? NaN : Number(activeTabId);

  if (Number.isInteger(normalizedActiveTabId)) {
    const activeTab = tabs.find((tab) => tab?.id === normalizedActiveTabId);

    return activeTab ?? null;
  }

  return tabs.find((tab) => tab?.active === true) ?? null;
}
