export async function reloadAllExtensionTabs({
  runtime = globalThis.chrome?.runtime,
  tabsApi = globalThis.chrome?.tabs,
} = {}) {
  const tabs = await queryExtensionTabs(tabsApi, {});
  let reloaded = 0;

  for (const tab of tabs.filter(isLoadedExtensionTab)) {
    if (await reloadTab({ runtime, tabId: tab.id, tabsApi })) {
      reloaded += 1;
    }
  }

  return { reloaded };
}

export function isPromptableExtensionTab(tab) {
  if (!Number.isInteger(tab?.id) || typeof tab.url !== 'string') {
    return false;
  }

  try {
    return ['http:', 'https:'].includes(new URL(tab.url).protocol);
  } catch {
    return false;
  }
}

export function isLoadedExtensionTab(tab) {
  return isPromptableExtensionTab(tab)
    && tab.status === 'complete'
    && tab.discarded !== true
    && tab.frozen !== true;
}

export function queryExtensionTabs(tabsApi, query) {
  if (typeof tabsApi?.query !== 'function') {
    return Promise.resolve([]);
  }

  return new Promise((resolve) => {
    try {
      tabsApi.query(query, (tabs) => resolve(Array.isArray(tabs) ? tabs : []));
    } catch {
      resolve([]);
    }
  });
}

function reloadTab({ runtime, tabId, tabsApi }) {
  if (typeof tabsApi?.reload !== 'function') {
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    try {
      tabsApi.reload(tabId, {}, () => {
        const failed = Boolean(runtime?.lastError);

        resolve(!failed);
      });
    } catch {
      resolve(false);
    }
  });
}
