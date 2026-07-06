import { normalizeComparableUrl } from '../shared/comparable-url.js';
import { normalizeTabDomain } from '../shared/tab-domain.js';

export function createOpenTabRegistry() {
  const tabById = new Map();
  const countByUrl = new Map();
  const domainCountByWindow = new Map();
  const totalTabsByWindow = new Map();

  function replaceTabs(tabs) {
    tabById.clear();
    countByUrl.clear();
    domainCountByWindow.clear();
    totalTabsByWindow.clear();

    for (const tab of Array.isArray(tabs) ? tabs : []) {
      const tabId = Number(tab?.id);

      if (!Number.isInteger(tabId)) {
        continue;
      }

      setTabRecord(tabId, tabRecordFrom(tab.url, tab.windowId));
    }
  }

  function updateTab(tabId, url, options = {}) {
    if (!Number.isInteger(tabId)) {
      return [];
    }

    const previous = tabById.get(tabId) ?? null;
    const windowId = normalizeWindowId(options.windowId) ?? previous?.windowId ?? null;

    return setTabRecord(tabId, tabRecordFrom(url, windowId));
  }

  function removeTab(tabId) {
    if (!Number.isInteger(tabId)) {
      return [];
    }

    return setTabRecord(tabId, null);
  }

  function getCounts(urls = null) {
    const entries = urls === null
      ? countByUrl.entries()
      : normalizeUrlList(urls).map((url) => [url, countByUrl.get(url) ?? 0]);

    return Object.fromEntries(
      [...entries].filter(([, count]) => count > 0),
    );
  }

  function getTabCounter(tabId) {
    const tab = Number.isInteger(tabId) ? tabById.get(tabId) : null;

    if (!tab?.domain || !Number.isInteger(tab.windowId)) {
      return null;
    }

    const totalTabsInWindow = totalTabsByWindow.get(tab.windowId) ?? 0;
    const sameDomainTabs = domainCountByWindow.get(tab.windowId)?.get(tab.domain) ?? 0;

    if (sameDomainTabs <= 0 || totalTabsInWindow <= 0) {
      return null;
    }

    return {
      domain: tab.domain,
      sameDomainTabs,
      totalTabsInWindow,
    };
  }

  function getWindowId(tabId) {
    return Number.isInteger(tabId) ? tabById.get(tabId)?.windowId ?? null : null;
  }

  function getWindowTabIds(windowId) {
    const normalizedWindowId = normalizeWindowId(windowId);

    if (normalizedWindowId === null) {
      return [];
    }

    return [...tabById.entries()]
      .filter(([, tab]) => tab.windowId === normalizedWindowId)
      .map(([tabId]) => tabId)
      .sort((left, right) => left - right);
  }

  function moveTab(tabId, windowId) {
    const previous = Number.isInteger(tabId) ? tabById.get(tabId) : null;

    if (!previous) {
      return [];
    }

    return setTabRecord(tabId, {
      ...previous,
      windowId: normalizeWindowId(windowId),
    });
  }

  function setTabRecord(tabId, nextTab) {
    const previousTab = tabById.get(tabId) ?? null;
    const previousUrl = previousTab?.comparableUrl ?? null;
    const nextUrl = nextTab?.comparableUrl ?? null;

    if (tabsAreEqual(previousTab, nextTab)) {
      return [];
    }

    decrementTabCounts(previousTab);

    if (previousUrl !== null) {
      decrement(previousUrl);
    }

    if (nextTab === null) {
      tabById.delete(tabId);
    } else {
      tabById.set(tabId, nextTab);
      incrementTabCounts(nextTab);

      if (nextUrl !== null) {
        increment(nextUrl);
      }
    }

    return uniqueNonNull([previousUrl, nextUrl]);
  }

  function increment(url) {
    countByUrl.set(url, (countByUrl.get(url) ?? 0) + 1);
  }

  function decrement(url) {
    const nextCount = (countByUrl.get(url) ?? 0) - 1;

    if (nextCount <= 0) {
      countByUrl.delete(url);

      return;
    }

    countByUrl.set(url, nextCount);
  }

  function incrementTabCounts(tab) {
    if (!Number.isInteger(tab?.windowId)) {
      return;
    }

    incrementMap(totalTabsByWindow, tab.windowId);

    if (tab.domain !== null) {
      incrementMap(domainCountsForWindow(domainCountByWindow, tab.windowId), tab.domain);
    }
  }

  function decrementTabCounts(tab) {
    if (!Number.isInteger(tab?.windowId)) {
      return;
    }

    decrementMap(totalTabsByWindow, tab.windowId);

    if (tab.domain !== null) {
      decrementMap(domainCountsForWindow(domainCountByWindow, tab.windowId), tab.domain);
    }
  }

  return {
    getCounts,
    getTabCounter,
    getWindowId,
    getWindowTabIds,
    moveTab,
    removeTab,
    replaceTabs,
    updateTab,
  };
}

function tabRecordFrom(url, windowId) {
  return {
    comparableUrl: normalizeComparableUrl(url),
    domain: normalizeTabDomain(url),
    windowId: normalizeWindowId(windowId),
  };
}

function normalizeWindowId(value) {
  const number = Number(value);

  return Number.isInteger(number) ? number : null;
}

function tabsAreEqual(left, right) {
  return (left?.comparableUrl ?? null) === (right?.comparableUrl ?? null)
    && (left?.domain ?? null) === (right?.domain ?? null)
    && (left?.windowId ?? null) === (right?.windowId ?? null);
}

function domainCountsForWindow(domainCountByWindow, windowId) {
  if (!domainCountByWindow.has(windowId)) {
    domainCountByWindow.set(windowId, new Map());
  }

  return domainCountByWindow.get(windowId);
}

function incrementMap(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function decrementMap(map, key) {
  const nextCount = (map.get(key) ?? 0) - 1;

  if (nextCount <= 0) {
    map.delete(key);

    return;
  }

  map.set(key, nextCount);
}

function normalizeUrlList(urls) {
  return uniqueNonNull(
    (Array.isArray(urls) ? urls : [])
      .map((url) => normalizeComparableUrl(url)),
  );
}

function uniqueNonNull(values) {
  return [...new Set(values.filter((value) => value !== null))];
}
