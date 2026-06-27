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
import { createPusherReverbClient } from './pusher-reverb-client.js';
import { createOpenTabRegistry } from './tab-state.js';

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
      }),
    });

    return false;
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

globalThis.chrome?.storage?.onChanged?.addListener?.((changes, areaName) => {
  if (areaName !== 'local' || !changes.atlasExtensionConfig) {
    return;
  }

  void ensureReverbConnection(null, { closeWhenMissing: true });
});

globalThis.chrome?.runtime?.onStartup?.addListener?.(() => {
  void ensureReverbConnection();
});

globalThis.chrome?.runtime?.onInstalled?.addListener?.(() => {
  void ensureReverbConnection();
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
    })
    : await postAssetReaction({
      asset: message.asset,
      config,
      downloadAction: message.downloadAction,
      reactionType: message.reactionType,
      referrerUrl: message.referrerUrl,
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
    broadcastOpenTabCountChanges(openTabs.updateTab(Number(tab?.id), tab?.url));
  });

  tabsApi.onUpdated?.addListener?.((tabId, changeInfo, tab) => {
    const url = typeof changeInfo?.url === 'string' ? changeInfo.url : tab?.url;

    if (typeof url === 'string') {
      broadcastOpenTabCountChanges(openTabs.updateTab(tabId, url));
    }
  });

  tabsApi.onRemoved?.addListener?.((tabId) => {
    closeTabIntents.removeTab(tabId);
    broadcastOpenTabCountChanges(openTabs.removeTab(tabId));
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
