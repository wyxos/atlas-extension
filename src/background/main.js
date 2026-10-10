import { createBrowserReferrers, createCoalescedDownloadRelay } from './browser-referrers.js';
import {
  createBatchReactionPoster,
  deleteAtlasFile,
  fetchAssetStatuses,
  postAssetReaction,
  reactionPreviewTransport,
} from './desktop-api.js';
import { createCloseTabIntentManager } from './close-tab-intents.js';
import { createContentInterestRegistry } from './content-interest-registry.js';
import { deliverContentResync } from './content-resync.js';
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
import { createRequestSessionCapture } from './request-session-capture.js';
import { withReactionPageContext } from './reaction-page-context.js';
import { loadAssetSourcePreferences } from '../shared/asset-source-preferences.js';
import { loadNextTabsFromActive } from './load-next-tabs.js';
import { loadNextTabsRequestType } from '../shared/load-next-tabs-messages.js';
import { tabCounterSnapshotRequestType } from '../shared/tab-counter-messages.js';
import { createDesktopContractError, serializeDesktopError } from '../shared/desktop-contract.js';
import { reactionFailureCodes, reactionMessageTypes, reactionRequestId } from '../shared/reaction-diagnostics.js';
import { createReactionFailureHistory } from './reaction-diagnostics.js';
import { reactionFailureFromError } from '../content/reaction-failure-state.js';
import { createDesktopRuntime } from './desktop-runtime.js';
import { createDownloadEventState } from './download-event-state.js';
import { createEventProbeRunner } from './event-probe-runtime.js';
import { createPerformanceDiagnosticStore } from './performance-diagnostics.js';
import { fanoutTabMessage } from './message-fanout.js';
const openTabs = createOpenTabRegistry();
const requestSessionCapture = createRequestSessionCapture(); requestSessionCapture.bind();
const performanceDiagnostics = createPerformanceDiagnosticStore();
const browserPages = createBrowserReferrers(body => desktopRuntime.resolveBrowserPages(body), () => contentInterests);
const contentInterests = createContentInterestRegistry({ canonicalProviderPage: browserPages.canonical });
const downloadEvents = createDownloadEventState();
const postPreparedReactionBatch = createBatchReactionPoster();
const downloadRelays = createCoalescedDownloadRelay({ deliver: relayTargetedDownloadEvent });
const closeTabIntents = createCloseTabIntentManager({
  onMetric: (metric) => performanceDiagnostics.record(metric),
  resolveAssetStatuses: async (assetUrls) => fetchAssetStatuses({ assetUrls, ...await desktopRuntime.requestContext() }),
});
const eventProbes = createEventProbeRunner({
  queryActiveTab: async () => (await queryTabs({ active: true, currentWindow: true }))[0],
  requestContext: () => desktopRuntime.requestContext(),
  sendToTab: sendTabMessage,
});
const reactionFailures = createReactionFailureHistory();
const desktopRuntime = createDesktopRuntime({
  reactionFailures: () => reactionFailures.snapshot(),
  onConnected: context => { void reactionFailures.flush(context).catch(() => {}); },
  onDownloadEvent: relayDownloadEvent,
  onDiagnosticEvent: (payload) => eventProbes.receive(payload),
  onResyncRequired: relayDesktopResyncRequired,
});
async function recordReactionFailure(failure) {
  try {
    await reactionFailures.record(failure);
    await reactionFailures.flush(await desktopRuntime.requestContext());
  } catch { /* Keep the bounded local evidence until the next connection event. */ }
}
globalThis.chrome?.runtime?.onMessage?.addListener?.((message, sender, sendResponse) => {
  if (message?.type === 'atlas-extension.reaction-failure') {
    void recordReactionFailure(message.failure).then(() => sendResponse({ ok: true, payload: {} }));
    return true;
  }
  const diagnosticResult = performanceDiagnostics.handleMessage(message, sendResponse);
  if (diagnosticResult !== null) {
    return diagnosticResult;
  }
  if (desktopRuntime.handleMessage(message, sendResponse)) {
    return true;
  }
  if (message?.type === 'atlas-extension.content-interests-remove') {
    void contentInterests.ready.then(() => contentInterests.removeFrame(
      sender?.tab?.id, sender?.frameId ?? 0, sender?.documentId ?? message.documentId,
    ));
    return false;
  }
  if (message?.type === 'atlas-extension.content-interests') {
    void contentInterests.ready.then(async () => {
      const payload = await browserPages.register({
        documentId: sender?.documentId ?? message.documentId,
        frameId: sender?.frameId ?? 0,
        pageUrl: message.pageUrl,
        referrerUrls: message.referrerUrls,
        sequence: message.sequence,
        sourceUrls: message.sourceUrls,
        tabId: sender?.tab?.id,
      });
      const pending = contentInterests.targetState(sender?.tab?.id);
      if (pending?.providerChanged) {
        payload.providerChanged = true;
        payload.resyncRequired = true;
      }
      const resyncToken = contentInterests.resyncToken(sender?.tab?.id);
      sendResponse({ ok: true, payload });
      if (payload.accepted && payload.resyncRequired) {
        contentInterests.markResynced(sender?.tab?.id, resyncToken);
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
  if (message?.type === 'atlas-extension.gallery-segment-acknowledged') {
    if (sender?.tab?.id !== undefined) postPreparedReactionBatch.acknowledge({ tabId: sender.tab.id, idempotencyKey: message.idempotencyKey });
    sendResponse({ ok: true, payload: { acknowledged: true } });
    return false;
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
  const requestId = reactionMessageTypes.includes(message.type) ? reactionRequestId(message.requestId) : undefined;
  void handleAtlasApiMessage(withReactionPageContext({ ...message, requestId }, sender), sender?.tab?.id, sender?.frameId ?? 0, sender?.documentId)
    .then((payload) => sendResponse({ ok: true, payload }))
    .catch((error) => {
      if (!error || typeof error !== 'object') error = createDesktopContractError('REACTION_REQUEST_FAILED', 'The reaction request failed.', true);
      if (requestId && !error.requestId) error.requestId = requestId;
      if (requestId && reactionFailureCodes.includes(error.code)) void recordReactionFailure({
        requestId: error.requestId, code: error.code,
        phase: error.code.startsWith('BROWSER_SESSION') ? 'preparing-session' : 'sending-request',
        operation: message.type.endsWith('-batch') ? 'reaction-batch' : 'reaction',
      });
      const failure = requestId ? reactionFailureFromError(error) : null;
      sendResponse({ error: failure ? { code: failure.errorCode, message: failure.message,
        ...(failure.details ? { details: failure.details } : {}),
        requestId: failure.requestId, retryable: failure.retryable } : serializeDesktopError(error), ok: false });
    });
  return true;
});
bindOpenTabTracking();
globalThis.chrome?.webNavigation?.onCommitted?.addListener?.(({ tabId, frameId }) => {
  void contentInterests.ready.then(() => {
    if (frameId === 0) contentInterests.remove(tabId);
    else contentInterests.removeFrame(tabId, frameId);
  });
});
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
async function handleAtlasApiMessage(message, tabId, frameId, documentId) {
  const preview = message.previewOnly === true
    && ['atlas-extension.asset-reaction', 'atlas-extension.asset-reaction-batch'].includes(message.type);
  const { credentials, transport: baseTransport } = preview
    ? { transport: reactionPreviewTransport }
    : await desktopRuntime.requestContext();
  const transport = { ...baseTransport,
    reaction: (client, body, options) => baseTransport.reaction(client, body, { ...options, requestId: message.requestId }),
    reactionBatch: (client, body, options) => baseTransport.reactionBatch(client, body, { ...options, requestId: message.requestId }),
  };
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
  if (message.type === 'atlas-extension.asset-reaction-batch') {
    return postPreparedReactionBatch({
      credentials,
      downloadAction: message.downloadAction,
      ...(message.idempotencyKey === undefined ? {} : { idempotencyKey: message.idempotencyKey }),
      ...(message.acknowledgedIdempotencyKey === undefined ? {} : { acknowledgedIdempotencyKey: message.acknowledgedIdempotencyKey }),
      items: message.items,
      reactionType: message.reactionType,
      useBrowserDownload: message.useBrowserDownload,
      tabId, previewOnly: preview,
      prepareContext: async () => ({
        preferences: await loadAssetSourcePreferences(),
        runtimeContext: await collectReactionRuntimeContext(message, { tabId, frameId, documentId, requireTab: true, requestCapture: requestSessionCapture }),
      }),
      transport,
    });
  }
  return postAssetReaction({
    preferences: await loadAssetSourcePreferences(),
    asset: message.asset,
    credentials,
    downloadAction: message.downloadAction,
    reactionType: message.reactionType,
    useBrowserDownload: message.useBrowserDownload,
    referrerUrl: message.referrerUrl,
    runtimeContext: await collectReactionRuntimeContext(message, { tabId, frameId, documentId, requireTab: true, requestCapture: requestSessionCapture }),
    source: message.source,
    transport,
  });
}
function isAtlasApiMessage(message) {
  return [
    'atlas-extension.asset-reaction-batch',
    'atlas-extension.asset-reaction', 'atlas-extension.asset-statuses', 'atlas-extension.file-delete',
  ].includes(message?.type);
}
function relayDownloadEvent(payload) {
  const acceptedPayload = downloadEvents.accept(payload);
  if (acceptedPayload === null) return;
  closeTabIntents.handleDownloadEvent(acceptedPayload);
  if (!downloadRelays.submit(acceptedPayload)) {
    for (const tabId of contentInterests.matchingTabIds(acceptedPayload)) contentInterests.markNeedsResync(tabId);
  }
}
async function relayTargetedDownloadEvent(payload) {
  await contentInterests.ready;
  const mapping = await browserPages.prepare([payload.referrerUrl]);
  if (!mapping.isCurrent()) return;
  const tabIds = contentInterests.matchingTabIds(payload, mapping.canonical(payload.referrerUrl));
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
      registeredTabs: contentInterests.size(),
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
  downloadRelays.clear(); browserPages.clear(); closeTabIntents.reconcile();
  void contentInterests.ready.then(() => Promise.all(
    contentInterests.snapshot().map(({ tabId }) => deliverTargetedResync(tabId)),
  ));
}
function deliverTargetedResync(tabId, providerChanged = true) {
  return deliverContentResync({ registry: contentInterests, sendMessage: sendTabMessage, tabId, providerChanged });
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
      if (shouldResync) void deliverTargetedResync(tabId, false);
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
    postPreparedReactionBatch.removeTab(tabId);
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
