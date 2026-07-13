import {
  deleteAtlasFile,
  fetchAssetStatuses,
  loadAtlasContentConfig,
  postAssetReactionBatch,
  postAssetReaction,
} from '../content/atlas-api.js';
import {
  resolveReverbConnectionConfig,
} from './reverb-config.js';
import { createCloseTabIntentManager } from './close-tab-intents.js';
import {
  bindPendingExtensionReloadNoticeDelivery,
  deliverPendingExtensionReloadNotice,
  extensionReloadAllTabsRequestType,
  handleExtensionReloadUpdate,
  extensionReloadRequestType,
  handleExtensionReloadRequest,
} from './extension-reload.js';
import { reloadAllExtensionTabs } from './extension-tabs.js';
import { createPusherReverbClient } from './pusher-reverb-client.js';
import { createOpenTabRegistry } from './tab-state.js';
import {
  broadcastTabCounterSnapshots,
  handleTabCounterSnapshotRequest,
} from './tab-counter.js';
import { collectReactionRuntimeContext } from './reaction-runtime-context.js';
import { loadNextTabsFromActive } from './load-next-tabs.js';
import { loadNextTabsRequestType } from '../shared/load-next-tabs-messages.js';
import { tabCounterSnapshotRequestType } from '../shared/tab-counter-messages.js';
import {
  syncExtensionSettings,
  uploadSettingsAfterStorageChange,
} from '../shared/settings-sync.js';

let activeReverbClient = null;
let activeConfigKey = null;
let isConnecting = false;
const openTabs = createOpenTabRegistry();
const closeTabIntents = createCloseTabIntentManager();

globalThis.chrome?.runtime?.onMessage?.addListener?.((message, sender, sendResponse) => {
  if (message?.type === 'atlas-extension.open-referrer-counts') {
    sendResponse({
      ok: true,
      payload: {
        counts: openTabs.getCounts(message.referrerUrls),
      },
    });

    return false;
  }

  if (message?.type === 'atlas-extension.open-referrer-url') {
    return handleOpenReferrerUrlMessage(message, sendResponse);
  }

  if (message?.type === 'atlas-extension.ensure-reverb') {
    void ensureReverbConnection();

    return false;
  }

  if (message?.type === 'atlas-extension.download-close-intent') {
    sendResponse({
      ok: true,
      payload: closeTabIntents.armCloseIntent({
        assetUrls: message.assetUrls,
        mode: message.mode,
        siteDomain: message.siteDomain,
        tabId: sender?.tab?.id,
        waitForDownloads: message.waitForDownloads,
      }),
    });

    return false;
  }

  if (message?.type === tabCounterSnapshotRequestType) {
    sendResponse({
      ok: true,
      payload: handleTabCounterSnapshotRequest({ message, openTabs, sender }),
    });

    return false;
  }

  if (message?.type === loadNextTabsRequestType) {
    void loadNextTabsFromActive({
      activeTabId: message.activeTabId,
      limit: message.limit,
      windowId: message.windowId,
    })
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => sendResponse({
        error: error?.message ?? 'Tabs could not be loaded.',
        ok: false,
      }));

    return true;
  }

  if (message?.type === extensionReloadRequestType) {
    void handleExtensionReloadRequest()
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => sendResponse({
        error: error?.message ?? 'Extension reload failed.',
        ok: false,
      }));

    return true;
  }

  if (message?.type === extensionReloadAllTabsRequestType) {
    void reloadAllExtensionTabs()
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => sendResponse({
        error: error?.message ?? 'Tabs could not be reloaded.',
        ok: false,
      }));

    return true;
  }

  if (!isAtlasApiMessage(message)) {
    return false;
  }

  void handleAtlasApiMessage(message)
    .then((payload) => sendResponse({ ok: true, payload }))
    .catch((error) => sendResponse({
      error: error?.message ?? 'Atlas extension background request failed.',
      ok: false,
    }));

  return true;
});

bindOpenTabTracking();
bindPendingExtensionReloadNoticeDelivery();
void syncExtensionSettings();
void deliverPendingExtensionReloadNotice();

globalThis.chrome?.storage?.onChanged?.addListener?.((changes, areaName) => {
  if (areaName === 'local' && changes.atlasExtensionConfig) {
    void ensureReverbConnection(null, { closeWhenMissing: true });
  }

  void uploadSettingsAfterStorageChange(changes, areaName);
});

globalThis.chrome?.runtime?.onStartup?.addListener?.(() => {
  void ensureReverbConnection();
  void syncExtensionSettings();
});

globalThis.chrome?.runtime?.onInstalled?.addListener?.((details) => {
  void ensureReverbConnection();
  void syncExtensionSettings();
  void handleExtensionReloadUpdate({ details });
});

async function ensureReverbConnection(configOverride = null, options = {}) {
  if (isConnecting) {
    return;
  }

  const config = await resolveReverbConnectionConfig(configOverride ?? await loadAtlasContentConfig());
  const reverb = config?.reverb;
  const nextConfigKey = reverbConfigKey(config);

  if (!reverb?.enabled || nextConfigKey === null) {
    if (options.closeWhenMissing === true) {
      closeActiveReverbClient();
    }

    return;
  }

  if (activeReverbClient !== null && activeConfigKey === nextConfigKey) {
    return;
  }

  isConnecting = true;
  closeActiveReverbClient();

  try {
    const client = await createPusherReverbClient(config);

    if (client === null) {
      return;
    }

    activeConfigKey = nextConfigKey;
    activeReverbClient = client;
    activeReverbClient.onEvent(relayDownloadEvent);
  } finally {
    isConnecting = false;
  }
}

async function handleAtlasApiMessage(message) {
  const config = await loadAtlasContentConfig();

  if (message.type === 'atlas-extension.asset-statuses') {
    return fetchAssetStatuses({
      assetUrls: message.assetUrls,
      config,
      matchItems: message.matchItems,
      referrerUrls: message.referrerUrls,
    });
  }

  if (message.type === 'atlas-extension.file-delete') {
    return deleteAtlasFile({
      config,
      fileId: message.fileId,
    });
  }

  const payload = message.type === 'atlas-extension.asset-reaction-batch'
    ? await postAssetReactionBatch({
      config,
      downloadAction: message.downloadAction,
      items: message.items,
      reactionType: message.reactionType,
      runtimeContext: await collectReactionRuntimeContext(message),
    })
    : await postAssetReaction({
      asset: message.asset,
      config,
      downloadAction: message.downloadAction,
      reactionType: message.reactionType,
      referrerUrl: message.referrerUrl,
      runtimeContext: await collectReactionRuntimeContext(message),
      source: message.source,
    });

  void ensureReverbConnection({
    ...config,
    reverb: payload.reverb,
  });

  return payload;
}

function isAtlasApiMessage(message) {
  return [
    'atlas-extension.asset-reaction-batch',
    'atlas-extension.asset-reaction',
    'atlas-extension.asset-statuses',
    'atlas-extension.file-delete',
  ].includes(message?.type);
}

function relayDownloadEvent(payload) {
  closeTabIntents.handleDownloadEvent(payload);

  globalThis.chrome?.tabs?.query?.({}, (tabs) => {
    for (const tab of tabs) {
      if (!Number.isInteger(tab.id)) {
        continue;
      }

      globalThis.chrome?.tabs?.sendMessage?.(tab.id, {
        payload,
        type: 'atlas-extension.download-event',
      }, () => {
        void globalThis.chrome?.runtime?.lastError;
      });
    }
  });
}

function bindOpenTabTracking() {
  const tabsApi = globalThis.chrome?.tabs;

  if (!tabsApi) {
    return;
  }

  tabsApi.query?.({}, (tabs) => {
    openTabs.replaceTabs(tabs);
  });

  tabsApi.onCreated?.addListener?.((tab) => {
    const tabId = Number(tab?.id);

    broadcastOpenTabCountChanges(openTabs.updateTab(tabId, tab?.url, {
      windowId: tab?.windowId,
    }));
    broadcastTabCounterChanges([tab?.windowId]);
  });

  tabsApi.onUpdated?.addListener?.((tabId, changeInfo, tab) => {
    const url = typeof changeInfo?.url === 'string' ? changeInfo.url : tab?.url;

    if (typeof url === 'string') {
      const previousWindowId = openTabs.getWindowId(tabId);

      broadcastOpenTabCountChanges(openTabs.updateTab(tabId, url, {
        windowId: tab?.windowId,
      }));
      broadcastTabCounterChanges([previousWindowId, openTabs.getWindowId(tabId)]);
    }
  });

  tabsApi.onRemoved?.addListener?.((tabId) => {
    const previousWindowId = openTabs.getWindowId(tabId);

    closeTabIntents.removeTab(tabId);
    broadcastOpenTabCountChanges(openTabs.removeTab(tabId));
    broadcastTabCounterChanges([previousWindowId]);
  });

  tabsApi.onDetached?.addListener?.((tabId, detachInfo) => {
    openTabs.moveTab(tabId, null);
    broadcastTabCounterChanges([detachInfo?.oldWindowId]);
  });

  tabsApi.onAttached?.addListener?.((tabId, attachInfo) => {
    const previousWindowId = openTabs.getWindowId(tabId);

    openTabs.moveTab(tabId, attachInfo?.newWindowId);
    broadcastTabCounterChanges([previousWindowId, attachInfo?.newWindowId]);
  });
}

function broadcastOpenTabCountChanges(changedUrls) {
  if (!Array.isArray(changedUrls) || changedUrls.length === 0) {
    return;
  }

  const tabsApi = globalThis.chrome?.tabs;
  const counts = openTabs.getCounts(changedUrls);

  tabsApi?.query?.({}, (tabs) => {
    for (const tab of tabs ?? []) {
      if (!Number.isInteger(tab.id)) {
        continue;
      }

      tabsApi.sendMessage?.(tab.id, {
        counts,
        type: 'atlas-extension.open-tab-counts-changed',
        urls: changedUrls,
      }, () => {
        void globalThis.chrome?.runtime?.lastError;
      });
    }
  });
}

function broadcastTabCounterChanges(windowIds) {
  broadcastTabCounterSnapshots({
    openTabs,
    tabsApi: globalThis.chrome?.tabs,
    windowIds,
  });
}

function handleOpenReferrerUrlMessage(message, sendResponse) {
  const url = normalizeHttpUrl(message.url);

  if (url === null) {
    sendResponse({
      error: 'Referrer URL is not a valid HTTP(S) URL.',
      ok: false,
    });

    return false;
  }

  if (typeof globalThis.chrome?.tabs?.create !== 'function') {
    sendResponse({
      error: 'Chrome tabs API is unavailable.',
      ok: false,
    });

    return false;
  }

  globalThis.chrome.tabs.create({ active: true, url }, () => {
    const error = globalThis.chrome?.runtime?.lastError?.message;

    sendResponse(error
      ? { error, ok: false }
      : { ok: true, payload: { opened: true } });
  });

  return true;
}

function normalizeHttpUrl(value) {
  if (typeof value !== 'string') {
    return null;
  }

  try {
    const url = new URL(value);

    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function closeActiveReverbClient() {
  try {
    activeReverbClient?.disconnect?.();
  } catch {
    // Ignore disconnect errors while Chrome is suspending the worker.
  }

  activeReverbClient = null;
  activeConfigKey = null;
}

function reverbConfigKey(config) {
  const reverb = config?.reverb;

  if (!reverb?.channel || !reverb?.host || !reverb?.key) {
    return null;
  }

  return [
    config.domain,
    config.apiKey,
    reverb.channel,
    reverb.host,
    reverb.port,
    reverb.scheme,
  ].join('|');
}
