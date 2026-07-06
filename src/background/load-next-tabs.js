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
    || (typeof tabsApi?.reload !== 'function' && typeof tabsApi?.update !== 'function')
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

  if (typeof tabsApi.reload === 'function') {
    return await reloadTabs({
      limit: normalizedLimit,
      runtime,
      tabsApi,
      tabsToLoad,
    });
  }

  return await activateTabs({
    activeTab,
    limit: normalizedLimit,
    runtime,
    tabsApi,
    tabsToLoad,
  });
}

async function reloadTabs({
  limit,
  runtime,
  tabsApi,
  tabsToLoad,
}) {
  const loadedTabIds = [];

  for (const tab of tabsToLoad) {
    await reloadTab({ runtime, tabId: tab.id, tabsApi });
    loadedTabIds.push(tab.id);
  }

  return {
    activated: 0,
    limit,
    reloaded: loadedTabIds.length,
    restored: false,
    tabIds: loadedTabIds,
  };
}

async function activateTabs({
  activeTab,
  limit,
  runtime,
  tabsApi,
  tabsToLoad,
}) {
  const activatedTabIds = [];

  try {
    for (const tab of tabsToLoad) {
      await activateTab({ runtime, tabId: tab.id, tabsApi });
      activatedTabIds.push(tab.id);
    }
  } finally {
    if (activatedTabIds.length > 0) {
      await activateTab({ runtime, tabId: activeTab.id, tabsApi });
    }
  }

  return {
    activated: activatedTabIds.length,
    limit,
    reloaded: 0,
    restored: activatedTabIds.length > 0,
    tabIds: activatedTabIds,
  };
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

function activateTab({ runtime, tabId, tabsApi }) {
  return new Promise((resolve, reject) => {
    tabsApi.update(tabId, { active: true }, (tab) => {
      const error = runtime?.lastError?.message;

      if (error) {
        reject(new Error(error));

        return;
      }

      resolve(tab);
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
  const normalizedActiveTabId = Number(activeTabId);

  if (Number.isInteger(normalizedActiveTabId)) {
    const activeTab = tabs.find((tab) => tab?.id === normalizedActiveTabId);

    if (activeTab) {
      return activeTab;
    }
  }

  return tabs.find((tab) => tab?.active === true) ?? null;
}
