import { loadNextTabsDefaultLimit } from '../shared/load-next-tabs-messages.js';

export async function loadNextTabsFromActive({
  activeTabId = null,
  limit = loadNextTabsDefaultLimit,
  runtime = globalThis.chrome?.runtime,
  tabsApi = globalThis.chrome?.tabs,
  windowId = null,
} = {}) {
  if (typeof tabsApi?.query !== 'function' || typeof tabsApi?.update !== 'function') {
    throw new Error('Chrome tabs API is unavailable.');
  }

  const normalizedLimit = normalizeLimit(limit);
  const tabs = await queryTabs({ runtime, tabsApi, windowId });
  const activeTab = findActiveTab(tabs, activeTabId);

  if (!Number.isInteger(activeTab?.id) || !Number.isInteger(activeTab?.index)) {
    throw new Error('No active tab is available.');
  }

  const tabsToActivate = tabs
    .filter((tab) => Number.isInteger(tab?.id) && Number.isInteger(tab?.index))
    .filter((tab) => tab.id !== activeTab.id && tab.index > activeTab.index)
    .sort((left, right) => left.index - right.index)
    .slice(0, normalizedLimit);
  const activatedTabIds = [];

  try {
    for (const tab of tabsToActivate) {
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
    limit: normalizedLimit,
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

function normalizeLimit(value) {
  const number = Number(value);

  if (!Number.isInteger(number) || number < 0) {
    return loadNextTabsDefaultLimit;
  }

  return Math.min(number, loadNextTabsDefaultLimit);
}
