import { normalizeComparableUrl } from '../shared/comparable-url.js';

export function createOpenTabRegistry() {
  const urlByTabId = new Map();
  const countByUrl = new Map();

  function replaceTabs(tabs) {
    urlByTabId.clear();
    countByUrl.clear();

    for (const tab of Array.isArray(tabs) ? tabs : []) {
      const tabId = Number(tab?.id);

      if (!Number.isInteger(tabId)) {
        continue;
      }

      setTabUrl(tabId, normalizeComparableUrl(tab.url));
    }
  }

  function updateTab(tabId, url) {
    if (!Number.isInteger(tabId)) {
      return [];
    }

    return setTabUrl(tabId, normalizeComparableUrl(url));
  }

  function removeTab(tabId) {
    if (!Number.isInteger(tabId)) {
      return [];
    }

    return setTabUrl(tabId, null);
  }

  function getCounts(urls = null) {
    const entries = urls === null
      ? countByUrl.entries()
      : normalizeUrlList(urls).map((url) => [url, countByUrl.get(url) ?? 0]);

    return Object.fromEntries(
      [...entries].filter(([, count]) => count > 0),
    );
  }

  function setTabUrl(tabId, nextUrl) {
    const previousUrl = urlByTabId.get(tabId) ?? null;

    if (previousUrl === nextUrl) {
      return [];
    }

    if (previousUrl !== null) {
      decrement(previousUrl);
    }

    if (nextUrl === null) {
      urlByTabId.delete(tabId);
    } else {
      urlByTabId.set(tabId, nextUrl);
      increment(nextUrl);
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

  return {
    getCounts,
    removeTab,
    replaceTabs,
    updateTab,
  };
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
