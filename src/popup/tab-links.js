export async function copyCurrentWindowTabLinksToClipboard({
  clipboard = globalThis.navigator?.clipboard,
  runtime = globalThis.chrome?.runtime,
  tabsApi = globalThis.chrome?.tabs,
} = {}) {
  if (typeof tabsApi?.query !== 'function') {
    return { error: 'Chrome tabs API is unavailable.', ok: false };
  }

  if (typeof clipboard?.writeText !== 'function') {
    return { error: 'Clipboard write API is unavailable.', ok: false };
  }

  try {
    const tabs = await queryTabs({
      query: { currentWindow: true },
      runtime,
      tabsApi,
    });
    const links = tabLinksFromTabs(tabs);

    if (links.length === 0) {
      return {
        error: 'No HTTP(S) tab links are open in this window.',
        ok: false,
        skipped: tabs.length,
      };
    }

    await clipboard.writeText(links.join('\n'));

    return {
      copied: links.length,
      ok: true,
      skipped: tabs.length - links.length,
    };
  } catch (error) {
    return {
      error: error?.message ?? 'Tab links could not be copied.',
      ok: false,
    };
  }
}

export async function openClipboardLinksInCurrentWindow({
  clipboard = globalThis.navigator?.clipboard,
  runtime = globalThis.chrome?.runtime,
  tabsApi = globalThis.chrome?.tabs,
} = {}) {
  if (typeof clipboard?.readText !== 'function') {
    return { error: 'Clipboard read API is unavailable.', ok: false };
  }

  if (typeof tabsApi?.create !== 'function' || typeof tabsApi?.query !== 'function') {
    return { error: 'Chrome tabs API is unavailable.', ok: false };
  }

  try {
    const clipboardText = await clipboard.readText();
    const { links, skipped } = extractWebLinks(clipboardText);

    if (links.length === 0) {
      return {
        error: 'Clipboard does not contain any HTTP(S) links.',
        ok: false,
        skipped,
      };
    }

    const windowId = await queryCurrentWindowId({ runtime, tabsApi });

    if (!Number.isInteger(windowId)) {
      return { error: 'No active window is available.', ok: false };
    }

    for (const url of links) {
      await createInactiveTab({ runtime, tabsApi, url, windowId });
    }

    return {
      ok: true,
      opened: links.length,
      skipped,
    };
  } catch (error) {
    return {
      error: error?.message ?? 'Clipboard links could not be opened.',
      ok: false,
    };
  }
}

function tabLinksFromTabs(tabs) {
  return [...tabs]
    .sort((left, right) => tabIndex(left) - tabIndex(right))
    .map((tab) => normalizeWebUrl(tab?.url))
    .filter((url) => url !== null);
}

function extractWebLinks(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const links = [];
  let skipped = 0;

  for (const line of lines) {
    const url = normalizeWebUrl(line);

    if (url === null) {
      skipped += 1;

      continue;
    }

    links.push(url);
  }

  return { links, skipped };
}

function normalizeWebUrl(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();

  if (trimmed === '') {
    return null;
  }

  try {
    const url = new URL(trimmed);

    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function tabIndex(tab) {
  return Number.isInteger(tab?.index) ? tab.index : Number.MAX_SAFE_INTEGER;
}

function queryCurrentWindowId({ runtime, tabsApi }) {
  return queryTabs({
    query: { active: true, currentWindow: true },
    runtime,
    tabsApi,
  }).then((tabs) => tabs[0]?.windowId ?? null);
}

function queryTabs({ query, runtime, tabsApi }) {
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

function createInactiveTab({
  runtime,
  tabsApi,
  url,
  windowId,
}) {
  return new Promise((resolve, reject) => {
    tabsApi.create({
      active: false,
      url,
      windowId,
    }, (tab) => {
      const error = runtime?.lastError?.message;

      if (error) {
        reject(new Error(error));

        return;
      }

      resolve(tab);
    });
  });
}
