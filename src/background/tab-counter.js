import {
  tabCounterChangedMessageType,
} from '../shared/tab-counter-messages.js';

export function handleTabCounterSnapshotRequest({
  message,
  openTabs,
  sender,
} = {}) {
  const tabId = Number(sender?.tab?.id);

  if (!Number.isInteger(tabId)) {
    return null;
  }

  openTabs.updateTab(tabId, currentTabUrl(message, sender), {
    windowId: sender?.tab?.windowId,
  });

  return openTabs.getTabCounter(tabId);
}

export function broadcastTabCounterSnapshots({
  openTabs,
  tabsApi,
  windowIds,
} = {}) {
  if (!openTabs || typeof tabsApi?.sendMessage !== 'function') {
    return;
  }

  for (const windowId of uniqueIntegerValues(windowIds)) {
    for (const tabId of openTabs.getWindowTabIds(windowId)) {
      const snapshot = openTabs.getTabCounter(tabId);

      if (snapshot === null) {
        continue;
      }

      tabsApi.sendMessage(tabId, {
        payload: snapshot,
        type: tabCounterChangedMessageType,
      }, () => {
        void globalThis.chrome?.runtime?.lastError;
      });
    }
  }
}

function currentTabUrl(message, sender) {
  return typeof message?.currentUrl === 'string'
    ? message.currentUrl
    : sender?.tab?.url;
}

function uniqueIntegerValues(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value)))];
}
