import {
  extensionReloadNoticeStorageKey,
  extensionReloadRequestType,
} from '../shared/extension-reload-messages.js';

export {
  extensionReloadNoticeStorageKey,
  extensionReloadRequestType,
};

let activeDelivery = null;

export async function handleExtensionReloadRequest({
  now = Date.now,
  runtime = globalThis.chrome?.runtime,
  setTimeout = globalThis.setTimeout,
  storageArea = globalThis.chrome?.storage?.local,
} = {}) {
  if (typeof runtime?.reload !== 'function') {
    throw new Error('Chrome runtime reload API is unavailable.');
  }

  if (typeof storageArea?.set !== 'function') {
    throw new Error('Chrome storage API is unavailable.');
  }

  await storePendingReloadNotice({ now, runtime, storageArea });
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
  windowsApi = globalThis.chrome?.windows,
} = {}) {
  if (details?.reason !== 'update' || typeof storageArea?.set !== 'function') {
    return {
      notified: 0,
      prompted: false,
      recorded: false,
    };
  }

  const activeDeliveryResult = await settleActiveDelivery();

  if (activeDeliveryResult?.prompted === true) {
    return {
      ...(activeDeliveryResult ?? { notified: 0, prompted: false }),
      recorded: false,
    };
  }

  const pendingNotice = await readPendingNotice(storageArea);

  if (pendingNotice !== null) {
    return {
      ...await deliverPendingExtensionReloadNotice({
        scriptingApi,
        storageArea,
        tabsApi,
        windowsApi,
      }),
      recorded: false,
    };
  }

  await storePendingReloadNotice({ now, runtime, storageArea });

  return {
    ...await deliverPendingExtensionReloadNotice({
      scriptingApi,
      storageArea,
      tabsApi,
      windowsApi,
    }),
    recorded: true,
  };
}

export async function deliverPendingExtensionReloadNotice(options = {}) {
  if (activeDelivery !== null) {
    return activeDelivery;
  }

  activeDelivery = deliverPendingExtensionReloadNoticeOnce(options);

  try {
    return await activeDelivery;
  } finally {
    activeDelivery = null;
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
  scriptingApi = globalThis.chrome?.scripting,
  storageArea = globalThis.chrome?.storage?.local,
  tabsApi = globalThis.chrome?.tabs,
  windowsApi = globalThis.chrome?.windows,
} = {}) {
  const notice = await readPendingNotice(storageArea);

  if (notice === null) {
    return {
      notified: 0,
      prompted: false,
    };
  }

  const tabs = await queryActiveTabs({ tabsApi, windowsApi });
  let notified = 0;

  for (const tab of tabs.filter(isPromptableTab)) {
    if (await injectReloadNotice({ notice, scriptingApi, tabId: tab.id })) {
      notified += 1;
    }
  }

  if (notified === 0) {
    return {
      notified: 0,
      prompted: false,
    };
  }

  await removeStorageValue(storageArea, extensionReloadNoticeStorageKey);

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
    version: normalizeVersion(value.version),
  };
}

async function settleActiveDelivery() {
  if (activeDelivery === null) {
    return null;
  }

  try {
    return await activeDelivery;
  } catch {
    return null;
  }
}

async function storePendingReloadNotice({ now, runtime, storageArea }) {
  await setStorageValues(storageArea, {
    [extensionReloadNoticeStorageKey]: {
      createdAt: now(),
      version: normalizeVersion(runtime?.getManifest?.().version),
    },
  });
}

async function injectReloadNotice({ notice, scriptingApi, tabId }) {
  if (typeof scriptingApi?.executeScript !== 'function') {
    return false;
  }

  try {
    await scriptingApi.executeScript({
      args: [notice],
      func: showExtensionReloadNotice,
      target: { tabId },
    });

    return true;
  } catch {
    return false;
  }
}

export function showExtensionReloadNotice(notice = {}) {
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
  cancelButton.textContent = 'Cancel';
  reloadButton.className = 'atlas-reload-action';
  reloadButton.type = 'button';
  reloadButton.textContent = 'Reload tab';

  cancelButton.addEventListener('click', () => host.remove());
  reloadButton.addEventListener('click', () => {
    host.remove();
    window.location.reload();
  });
  host.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      host.remove();
    }
  });

  footer.append(cancelButton, reloadButton);
  dialog.append(title, description, footer);
  shadowRoot.append(style, overlay, dialog);
  (document.body ?? document.documentElement).append(host);
  reloadButton.focus();
}

function isPromptableTab(tab) {
  if (!Number.isInteger(tab?.id) || typeof tab.url !== 'string') {
    return false;
  }

  try {
    return ['http:', 'https:'].includes(new URL(tab.url).protocol);
  } catch {
    return false;
  }
}

function queryTabs(tabsApi, query) {
  if (typeof tabsApi?.query !== 'function') {
    return Promise.resolve([]);
  }

  return new Promise((resolve) => {
    try {
      tabsApi.query(query, (tabs) => resolve(Array.isArray(tabs) ? tabs : []));
    } catch {
      resolve([]);
    }
  });
}

async function queryActiveTabs({ tabsApi, windowsApi }) {
  const windowTabs = await queryActiveWindowTabs(windowsApi);

  if (windowTabs !== null) {
    return windowTabs;
  }

  return await queryTabs(tabsApi, { active: true });
}

function queryActiveWindowTabs(windowsApi) {
  if (typeof windowsApi?.getAll !== 'function') {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    try {
      windowsApi.getAll({ populate: true, windowTypes: ['normal'] }, (windows) => {
        if (!Array.isArray(windows)) {
          resolve(null);

          return;
        }

        resolve(windows.flatMap((window) => {
          const tabs = Array.isArray(window?.tabs) ? window.tabs : [];

          return tabs.filter((tab) => tab?.active === true);
        }));
      });
    } catch {
      resolve(null);
    }
  });
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
