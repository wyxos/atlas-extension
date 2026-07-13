import {
  extensionReloadAllTabsRequestType,
  extensionReloadNoticeStorageKey,
  extensionReloadRequestType,
} from '../shared/extension-reload-messages.js';
import {
  isLoadedExtensionTab,
  queryExtensionTabs,
} from './extension-tabs.js';
import { settleScriptExecution } from './extension-script-execution.js';

export {
  extensionReloadAllTabsRequestType,
  extensionReloadNoticeStorageKey,
  extensionReloadRequestType,
};

const activeDeliveries = new Map();
const defaultInjectionTimeoutMs = 3000;
export async function handleExtensionReloadRequest({
  now = Date.now,
  runtime = globalThis.chrome?.runtime,
  setTimeout = globalThis.setTimeout,
  storageArea = globalThis.chrome?.storage?.local,
  tabsApi = globalThis.chrome?.tabs,
} = {}) {
  if (typeof runtime?.reload !== 'function') {
    throw new Error('Chrome runtime reload API is unavailable.');
  }

  if (typeof storageArea?.set !== 'function') {
    throw new Error('Chrome storage API is unavailable.');
  }

  await storePendingReloadNotice({ now, runtime, storageArea, tabsApi });
  setTimeout(() => runtime.reload(), 0);

  return { reloading: true };
}

export async function handleExtensionReloadUpdate({
  details = {},
  now = Date.now,
  runtime = globalThis.chrome?.runtime,
  scriptingApi = globalThis.chrome?.scripting,
  storageArea = globalThis.chrome?.storage?.local,
  tabsApi = globalThis.chrome?.tabs,
} = {}) {
  if (details?.reason !== 'update' || typeof storageArea?.set !== 'function') {
    return {
      notified: 0,
      prompted: false,
      recorded: false,
    };
  }

  const notice = await storePendingReloadNotice({ now, runtime, storageArea, tabsApi });

  return {
    ...await deliverPendingExtensionReloadNotice({
      notice,
      scriptingApi,
      storageArea,
      tabsApi,
    }),
    recorded: true,
  };
}

export async function deliverPendingExtensionReloadNotice(options = {}) {
  const storageArea = options.storageArea ?? globalThis.chrome?.storage?.local;
  const notice = options.notice ?? await readPendingNotice(storageArea);

  if (notice === null) {
    return {
      notified: 0,
      prompted: false,
    };
  }

  const deliveryKey = reloadNoticeDeliveryKey(notice);
  const existingDelivery = activeDeliveries.get(deliveryKey);

  if (existingDelivery) {
    return existingDelivery;
  }

  const delivery = deliverPendingExtensionReloadNoticeOnce({
    ...options,
    notice,
    storageArea,
  });

  activeDeliveries.set(deliveryKey, delivery);

  try {
    return await delivery;
  } finally {
    if (activeDeliveries.get(deliveryKey) === delivery) {
      activeDeliveries.delete(deliveryKey);
    }
  }
}

export function bindPendingExtensionReloadNoticeDelivery({
  deliver = deliverPendingExtensionReloadNotice,
  tabsApi = globalThis.chrome?.tabs,
  windowsApi = globalThis.chrome?.windows,
} = {}) {
  const retryDelivery = () => {
    void Promise.resolve(deliver()).catch(() => {});
  };

  tabsApi?.onActivated?.addListener?.(retryDelivery);
  tabsApi?.onUpdated?.addListener?.((_tabId, changeInfo, tab) => {
    if (
      tab?.active === true
      && (changeInfo?.status === 'complete' || typeof changeInfo?.url === 'string')
    ) {
      retryDelivery();
    }
  });
  windowsApi?.onFocusChanged?.addListener?.(retryDelivery);
}

async function deliverPendingExtensionReloadNoticeOnce({
  clearTimeout = globalThis.clearTimeout,
  injectionTimeoutMs = defaultInjectionTimeoutMs,
  notice,
  scriptingApi = globalThis.chrome?.scripting,
  setTimeout = globalThis.setTimeout,
  storageArea = globalThis.chrome?.storage?.local,
  tabsApi = globalThis.chrome?.tabs,
} = {}) {
  const tabs = await queryExtensionTabs(tabsApi, {});
  const tabsById = new Map(tabs.map((tab) => [tab.id, tab]));
  const pendingTabIds = notice.pendingTabIds
    ?? tabs.filter(isLoadedExtensionTab).map((tab) => tab.id);
  const targetTabIds = pendingTabIds.filter((tabId) => isLoadedExtensionTab(tabsById.get(tabId)));
  const deliveryResults = await Promise.all(targetTabIds.map(async (tabId) => ({
    delivered: await injectReloadNotice({
      clearTimeout,
      injectionTimeoutMs,
      notice,
      scriptingApi,
      setTimeout,
      tabId,
    }),
    tabId,
  })));
  const remainingTabIds = deliveryResults
    .filter(({ delivered }) => !delivered)
    .map(({ tabId }) => tabId);
  const notified = deliveryResults.length - remainingTabIds.length;

  await reconcilePendingNotice({ notice, remainingTabIds, storageArea });

  if (notified === 0) {
    return {
      notified: 0,
      prompted: false,
    };
  }

  return {
    notified,
    prompted: true,
  };
}

async function readPendingNotice(storageArea) {
  if (typeof storageArea?.get !== 'function') {
    return null;
  }

  const stored = await readStorageValue(storageArea, extensionReloadNoticeStorageKey);
  const value = stored[extensionReloadNoticeStorageKey];

  if (!value || typeof value !== 'object') {
    return null;
  }

  return {
    createdAt: Number.isFinite(value.createdAt) ? value.createdAt : null,
    pendingTabIds: normalizeTabIds(value.pendingTabIds),
    version: normalizeVersion(value.version),
  };
}

async function storePendingReloadNotice({ now, runtime, storageArea, tabsApi }) {
  const tabs = await queryExtensionTabs(tabsApi, {});
  const notice = {
    createdAt: now(),
    pendingTabIds: tabs.filter(isLoadedExtensionTab).map((tab) => tab.id),
    version: normalizeVersion(runtime?.getManifest?.().version),
  };

  await setStorageValues(storageArea, {
    [extensionReloadNoticeStorageKey]: notice,
  });
  return notice;
}

async function injectReloadNotice({
  clearTimeout,
  injectionTimeoutMs,
  notice,
  scriptingApi,
  setTimeout,
  tabId,
}) {
  if (typeof scriptingApi?.executeScript !== 'function') {
    return false;
  }

  try {
    const execution = scriptingApi.executeScript({
      args: [{ version: notice.version }, extensionReloadAllTabsRequestType],
      func: showExtensionReloadNotice,
      target: { tabId },
    });

    return await settleScriptExecution({
      clearTimeout,
      execution,
      setTimeout,
      timeoutMs: injectionTimeoutMs,
    });
  } catch {
    return false;
  }
}

async function reconcilePendingNotice({ notice, remainingTabIds, storageArea }) {
  const currentNotice = await readPendingNotice(storageArea);

  if (reloadNoticeDeliveryKey(currentNotice) !== reloadNoticeDeliveryKey(notice)) {
    return;
  }

  if (remainingTabIds.length === 0) {
    await removeStorageValue(storageArea, extensionReloadNoticeStorageKey);

    return;
  }

  await setStorageValues(storageArea, {
    [extensionReloadNoticeStorageKey]: {
      createdAt: notice.createdAt,
      pendingTabIds: remainingTabIds,
      version: notice.version,
    },
  });
}

function reloadNoticeDeliveryKey(notice) {
  if (notice === null || typeof notice !== 'object') {
    return null;
  }

  return `${notice.createdAt ?? 'unknown'}:${notice.version ?? 'unknown'}`;
}

export function showExtensionReloadNotice(
  notice = {},
  reloadAllRequestType = 'atlas-extension.reload-all-tabs',
) {
  const hostId = 'atlas-extension-reload-notice';
  const existingHost = document.getElementById(hostId);

  existingHost?.remove();

  const host = document.createElement('div');
  const shadowRoot = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  const overlay = document.createElement('div');
  const dialog = document.createElement('section');
  const title = document.createElement('h2');
  const description = document.createElement('p');
  const footer = document.createElement('div');
  const cancelButton = document.createElement('button');
  const reloadButton = document.createElement('button');
  const reloadAllButton = document.createElement('button');
  const version = typeof notice?.version === 'string' && notice.version.trim() !== ''
    ? ` ${notice.version.trim()}`
    : '';

  host.id = hostId;
  style.textContent = `
    :host {
      all: initial;
      color-scheme: dark;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    .atlas-reload-overlay {
      backdrop-filter: blur(3px);
      background: rgba(0, 0, 0, 0.52);
      inset: 0;
      position: fixed;
      z-index: 2147483646;
    }

    .atlas-reload-dialog {
      background: #111827;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 8px;
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.35);
      box-sizing: border-box;
      color: #f9fafb;
      display: grid;
      gap: 14px;
      left: 50%;
      max-width: calc(100vw - 32px);
      padding: 18px;
      position: fixed;
      top: 50%;
      transform: translate(-50%, -50%);
      width: min(420px, calc(100vw - 32px));
      z-index: 2147483647;
    }

    h2 {
      color: #f9fafb;
      font-size: 15px;
      font-weight: 700;
      line-height: 1.25;
      margin: 0;
    }

    p {
      color: #d1d5db;
      font-size: 13px;
      line-height: 1.45;
      margin: 0;
    }

    .atlas-reload-footer {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: flex-end;
    }

    button {
      appearance: none;
      border: 0;
      border-radius: 6px;
      cursor: pointer;
      font: 700 13px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      min-height: 34px;
      padding: 0 12px;
    }

    button:focus-visible {
      outline: 2px solid #93c5fd;
      outline-offset: 2px;
    }

    .atlas-reload-cancel {
      background: rgba(255, 255, 255, 0.12);
      color: #f9fafb;
    }

    .atlas-reload-cancel:hover {
      background: rgba(255, 255, 255, 0.2);
    }

    .atlas-reload-action {
      background: #0466c8;
      color: #fff;
    }

    .atlas-reload-action:hover {
      background: #0f85fa;
    }

    .atlas-reload-all {
      background: transparent;
      box-shadow: inset 0 0 0 1px rgba(147, 197, 253, 0.72);
      color: #bfdbfe;
    }

    .atlas-reload-all:hover {
      background: rgba(59, 130, 246, 0.16);
    }

    @media (max-width: 440px) {
      .atlas-reload-footer button {
        flex: 1 1 100%;
      }
    }
  `;
  overlay.className = 'atlas-reload-overlay';
  dialog.className = 'atlas-reload-dialog';
  dialog.setAttribute('aria-describedby', 'atlas-extension-reload-description');
  dialog.setAttribute('aria-labelledby', 'atlas-extension-reload-title');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('role', 'dialog');
  title.id = 'atlas-extension-reload-title';
  title.textContent = 'Extension reloaded';
  description.id = 'atlas-extension-reload-description';
  description.textContent = `Atlas Extension${version} has reloaded. Reload this tab so the page starts from the latest extension runtime.`;
  footer.className = 'atlas-reload-footer';
  cancelButton.className = 'atlas-reload-cancel';
  cancelButton.type = 'button';
  cancelButton.textContent = 'Dismiss';
  reloadButton.className = 'atlas-reload-action';
  reloadButton.type = 'button';
  reloadButton.textContent = 'Reload tab';
  reloadAllButton.className = 'atlas-reload-all';
  reloadAllButton.type = 'button';
  reloadAllButton.textContent = 'Reload all active tabs';

  cancelButton.addEventListener('click', () => host.remove());
  reloadButton.addEventListener('click', () => {
    host.remove();
    window.location.reload();
  });
  reloadAllButton.addEventListener('click', () => {
    host.remove();

    try {
      const request = globalThis.chrome?.runtime?.sendMessage?.({
        type: reloadAllRequestType,
      });

      request?.catch?.(() => window.location.reload());

      if (request === undefined) {
        window.location.reload();
      }
    } catch {
      window.location.reload();
    }
  });
  host.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      host.remove();
    }
  });

  footer.append(cancelButton, reloadAllButton, reloadButton);
  dialog.append(title, description, footer);
  shadowRoot.append(style, overlay, dialog);
  (document.body ?? document.documentElement).append(host);
  reloadButton.focus();
}

async function readStorageValue(storageArea, key) {
  if (storageArea.get.length >= 2) {
    return new Promise((resolve) => {
      storageArea.get(key, (result) => resolve(result ?? {}));
    });
  }

  return await storageArea.get(key) ?? {};
}

async function removeStorageValue(storageArea, key) {
  if (typeof storageArea?.remove !== 'function') {
    return;
  }

  if (storageArea.remove.length >= 2) {
    await new Promise((resolve) => {
      storageArea.remove(key, resolve);
    });

    return;
  }

  await storageArea.remove(key);
}

async function setStorageValues(storageArea, values) {
  if (storageArea.set.length >= 2) {
    await new Promise((resolve) => {
      storageArea.set(values, resolve);
    });

    return;
  }

  await storageArea.set(values);
}

function normalizeVersion(value) {
  return typeof value === 'string' && value.trim() !== ''
    ? value.trim()
    : null;
}

function normalizeTabIds(value) {
  if (!Array.isArray(value)) {
    return null;
  }

  return [...new Set(value.filter((tabId) => Number.isInteger(tabId)))];
}
