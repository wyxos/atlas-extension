import { openTabUrl } from './tab-state.js';

export function trackOpenTabs({
  tabsApi = globalThis.chrome?.tabs,
  openTabs,
  onCountsChanged,
  onCountersChanged,
  onSnapshot = () => {},
  onUpdated = () => {},
  onRemoved = () => {},
}) {
  if (!tabsApi) return Promise.resolve();
  let finishInitialization;
  const ready = new Promise(resolve => { finishInitialization = resolve; });
  let initializing = true;
  const pending = [];
  const changedUrls = new Set(Object.keys(openTabs.getCounts()));
  const changedWindows = new Set();
  const countsChanged = urls => {
    if (initializing) urls.forEach(url => changedUrls.add(url));
    else onCountsChanged(urls);
  };
  const countersChanged = ids => {
    if (initializing) ids.forEach(id => changedWindows.add(id));
    else onCountersChanged(ids);
  };
  const apply = operation => {
    if (initializing) pending.push(operation);
    else operation();
  };
  tabsApi.onCreated?.addListener?.(tab => {
    apply(() => {
      countsChanged(openTabs.updateTab(Number(tab?.id), openTabUrl(tab), { windowId: tab?.windowId }));
      countersChanged([tab?.windowId]);
    });
  });
  tabsApi.onUpdated?.addListener?.((tabId, changeInfo, tab) => {
    onUpdated(tabId, changeInfo, tab);
    apply(() => {
      const url = typeof changeInfo?.url === 'string' ? changeInfo.url : openTabUrl(tab);
      if (typeof url === 'string') {
        const previousWindowId = openTabs.getWindowId(tabId);
        countsChanged(openTabs.updateTab(tabId, url, { windowId: tab?.windowId }));
        countersChanged([previousWindowId, openTabs.getWindowId(tabId)]);
      }
    });
  });
  tabsApi.onRemoved?.addListener?.(tabId => {
    onRemoved(tabId);
    apply(() => {
      const previousWindowId = openTabs.getWindowId(tabId);
      countsChanged(openTabs.removeTab(tabId));
      countersChanged([previousWindowId]);
    });
  });
  tabsApi.onDetached?.addListener?.((tabId, info) => {
    apply(() => {
      openTabs.moveTab(tabId, null);
      countersChanged([info?.oldWindowId]);
    });
  });
  tabsApi.onAttached?.addListener?.((tabId, info) => {
    apply(() => {
      const previousWindowId = openTabs.getWindowId(tabId);
      openTabs.moveTab(tabId, info?.newWindowId);
      countersChanged([previousWindowId, info?.newWindowId]);
    });
  });

  // Subscribe before querying, then replay events over the snapshot so a late
  // startup reply cannot erase tabs created, navigated, closed or moved meanwhile.
  const initialize = tabs => {
    openTabs.replaceTabs(tabs);
    Object.keys(openTabs.getCounts()).forEach(url => changedUrls.add(url));
    for (const tab of tabs ?? []) changedWindows.add(tab.windowId);
    for (const operation of pending) operation();
    pending.length = 0;
    initializing = false;
    onSnapshot(tabs);
    onCountsChanged([...changedUrls]);
    onCountersChanged([...changedWindows]);
    changedUrls.clear();
    changedWindows.clear();
    finishInitialization();
  };
  if (typeof tabsApi.query === 'function') tabsApi.query({}, initialize);
  else initialize([]);
  return ready;
}

export async function replyWithOpenTabCounts({ ready, openTabs, message, sendResponse }) {
  await ready;
  sendResponse({ ok: true, payload: { counts: openTabs.getCounts(message.referrerUrls) } });
}
