import {
  deleteAtlasFile,
  fetchAssetStatuses,
  postAssetReactionBatch,
  postAssetReaction,
  reactionPreviewTransport,
} from './desktop-api.js';
import { createCloseTabIntentManager } from './close-tab-intents.js';
import { createContentInterestRegistry } from './content-interest-registry.js';
import {
  bindPendingExtensionReloadNoticeDelivery,
  deliverPendingExtensionReloadNotice,
  extensionReloadAllTabsRequestType,
  handleExtensionReloadUpdate,
  extensionReloadRequestType,
  handleExtensionReloadRequest,
} from './extension-reload.js';
import { reloadAllExtensionTabs } from './extension-tabs.js';
import { createOpenTabRegistry } from './tab-state.js';
import {
  broadcastTabCounterSnapshots,
  handleTabCounterSnapshotRequest,
} from './tab-counter.js';
import { collectReactionRuntimeContext } from './reaction-runtime-context.js';
import { loadNextTabsFromActive } from './load-next-tabs.js';
import { loadNextTabsRequestType } from '../shared/load-next-tabs-messages.js';
import { tabCounterSnapshotRequestType } from '../shared/tab-counter-messages.js';
import { serializeDesktopError } from '../shared/desktop-contract.js';
import { createDesktopRuntime } from './desktop-runtime.js';
import { createDownloadEventState } from './download-event-state.js';
import { createEventProbeRunner } from './event-probe-runtime.js';
import { createPerformanceDiagnosticStore } from './performance-diagnostics.js';
import { fanoutTabMessage } from './message-fanout.js';

const openTabs = createOpenTabRegistry();
const performanceDiagnostics = createPerformanceDiagnosticStore();
const contentInterests = createContentInterestRegistry();
const downloadEvents = createDownloadEventState();
const closeTabIntents = createCloseTabIntentManager({
  onMetric: (metric) => performanceDiagnostics.record(metric),
});
const eventProbes = createEventProbeRunner({
  queryActiveTab: async () => (await queryTabs({ active: true, currentWindow: true }))[0],
  requestContext: () => desktopRuntime.requestContext(),
  sendToTab: sendTabMessage,
});
const desktopRuntime = createDesktopRuntime({
  onDownloadEvent: relayDownloadEvent,
  onDiagnosticEvent: (payload) => eventProbes.receive(payload),
  onResyncRequired: relayDesktopResyncRequired,
});

globalThis.chrome?.runtime?.onMessage?.addListener?.((message, sender, sendResponse) => {
  const diagnosticResult = performanceDiagnostics.handleMessage(message, sendResponse);
  if (diagnosticResult !== null) {
    return diagnosticResult;
  }

  if (desktopRuntime.handleMessage(message, sendResponse)) {
    return true;
  }

  if (message?.type === 'atlas-extension.content-interests') {
    void contentInterests.ready.then(() => {
      const payload = contentInterests.register({
        documentId: sender?.documentId ?? message.documentId,
        pageUrl: message.pageUrl,
        referrerUrls: message.referrerUrls,
        sequence: message.sequence,
        sourceUrls: message.sourceUrls,
        tabId: sender?.tab?.id,
      });

      sendResponse({ ok: true, payload });
      if (payload.resyncRequired) {
        contentInterests.markResynced(sender?.tab?.id);
      }
    });

    return true;
  }

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

  if (message?.type === 'atlas-extension.download-close-intent') {
    void closeTabIntents.armCloseIntent({
        assetUrls: message.assetUrls,
        mode: message.mode,
        siteDomain: message.siteDomain,
        tabId: sender?.tab?.id,
        waitForDownloads: message.waitForDownloads,
      })
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => sendResponse({
        error: error?.message ?? 'Chrome could not prepare the tab close.',
        ok: false,
      }));

    return true;
  }

  if (message?.type === 'atlas-extension.desktop.test-event-path') {
    void eventProbes.testActiveTab()
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => sendResponse({
        error: serializeDesktopError(error, 'The event path test failed.'),
        ok: false,
      }));
    return true;
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
      error: serializeDesktopError(error),
      ok: false,
    }));

  return true;
});

bindOpenTabTracking();
bindPendingExtensionReloadNoticeDelivery();
void desktopRuntime.initialize();
void deliverPendingExtensionReloadNotice();

globalThis.chrome?.runtime?.onStartup?.addListener?.(() => {
  void desktopRuntime.initialize();
});

globalThis.chrome?.runtime?.onInstalled?.addListener?.((details) => {
  void desktopRuntime.initialize();
  void handleExtensionReloadUpdate({ details });
});

async function handleAtlasApiMessage(message) {
  const preview = message.previewOnly === true
    && ['atlas-extension.asset-reaction', 'atlas-extension.asset-reaction-batch'].includes(message.type);
  const { credentials, transport } = preview
    ? { transport: reactionPreviewTransport }
    : await desktopRuntime.requestContext();

  if (message.type === 'atlas-extension.asset-statuses') {
    return fetchAssetStatuses({
      assetUrls: message.assetUrls,
      credentials,
      matchItems: message.matchItems,
      referrerUrls: message.referrerUrls,
      transport,
    });
  }

  if (message.type === 'atlas-extension.file-delete') {
    return deleteAtlasFile({
      credentials,
      fileId: message.fileId,
      transport,
    });
  }

  const payload = message.type === 'atlas-extension.asset-reaction-batch'
    ? await postAssetReactionBatch({
      credentials,
      downloadAction: message.downloadAction,
      items: message.items,
      reactionType: message.reactionType,
      useBrowserDownload: message.useBrowserDownload,
      runtimeContext: await collectReactionRuntimeContext(message),
      transport,
    })
    : await postAssetReaction({
      asset: message.asset,
      credentials,
      downloadAction: message.downloadAction,
      reactionType: message.reactionType,
      useBrowserDownload: message.useBrowserDownload,
      referrerUrl: message.referrerUrl,
      runtimeContext: await collectReactionRuntimeContext(message),
      source: message.source,
      transport,
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
  const acceptedPayload = downloadEvents.accept(payload);

  if (acceptedPayload === null) {
    return;
  }

  closeTabIntents.handleDownloadEvent(acceptedPayload);
  void relayTargetedDownloadEvent(acceptedPayload);
}

async function relayTargetedDownloadEvent(payload) {
  await contentInterests.ready;
  const tabIds = contentInterests.matchingTabIds(payload);
  let deferred = 0;
  const deliverableTabIds = tabIds.filter((tabId) => {
    const state = contentInterests.targetState(tabId);
    if (state?.discarded || state?.frozen || state?.loading) {
      contentInterests.markNeedsResync(tabId);
      deferred += 1;
      return false;
    }
    return true;
  });
  const result = await fanoutTabMessage({
    message: { payload, type: 'atlas-extension.download-event' },
    metricDetails: {
      deferred,
      registeredTabs: contentInterests.snapshot().length,
    },
    onMetric: (metric) => performanceDiagnostics.record(metric),
    sendMessage: sendTabMessage,
    tabIds: deliverableTabIds,
  });
  for (const tabId of result.failedTabIds) contentInterests.markNeedsResync(tabId);
}

function queryTabs(query) {
  return new Promise((resolve, reject) => {
    globalThis.chrome?.tabs?.query?.(query, (tabs) => {
      const error = globalThis.chrome?.runtime?.lastError?.message;
      error ? reject(new Error(error)) : resolve(tabs ?? []);
    });
  });
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    globalThis.chrome?.tabs?.sendMessage?.(tabId, message, (response) => {
      const error = globalThis.chrome?.runtime?.lastError?.message;
      error ? reject(new Error(error)) : resolve(response?.payload ?? response ?? {});
    });
  });
}

function relayDesktopResyncRequired() {
  void contentInterests.ready.then(() => Promise.all(
    contentInterests.snapshot().map(({ tabId }) => deliverTargetedResync(tabId)),
  ));
}

async function deliverTargetedResync(tabId) {
  const state = contentInterests.targetState(tabId);
  if (state?.discarded || state?.frozen || state?.loading) {
    contentInterests.markNeedsResync(tabId);
    return false;
  }

  try {
    await sendTabMessage(tabId, {
      type: 'atlas-extension.desktop.resync-required',
    });
    contentInterests.markResynced(tabId);
    return true;
  } catch {
    contentInterests.markNeedsResync(tabId);
    return false;
  }
}

function bindOpenTabTracking() {
  const tabsApi = globalThis.chrome?.tabs;

  if (!tabsApi) {
    return;
  }

  tabsApi.query?.({}, (tabs) => {
    openTabs.replaceTabs(tabs);
    void contentInterests.ready.then(() => contentInterests.reconcileTabs(tabs));
  });

  tabsApi.onCreated?.addListener?.((tab) => {
    const tabId = Number(tab?.id);

    broadcastOpenTabCountChanges(openTabs.updateTab(tabId, tab?.url, {
      windowId: tab?.windowId,
    }));
    broadcastTabCounterChanges([tab?.windowId]);
  });

  tabsApi.onUpdated?.addListener?.((tabId, changeInfo, tab) => {
    void contentInterests.ready.then(() => {
      const { shouldResync } = contentInterests.updateLifecycle(tabId, changeInfo, tab);
      if (shouldResync) void deliverTargetedResync(tabId);
    });

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
    void contentInterests.ready.then(() => contentInterests.remove(tabId));
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
