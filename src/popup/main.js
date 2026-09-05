import { h, render } from 'vue';
import {
  Activity,
  ClipboardCopy,
  ClipboardPaste,
  Minus,
  Plus,
  RefreshCw,
  Rows3,
  ScanSearch,
  Settings,
} from '@lucide/vue';
import './style.css';
import { desktopConnectionStorageKey } from '../background/desktop-connection-state.js';
import { requestDesktopDiagnostics } from '../shared/desktop-messages.js';
import { requestNextTabsLoad } from './load-next-tabs.js';
import { describeDesktopStatus } from './desktop-status.js';
import { openExtensionOptions } from './open-options.js';
import { requestExtensionReload } from './reload-extension.js';
import { requestActiveTabScan } from './scan-active-tab.js';
import {
  copyCurrentWindowTabLinksToClipboard,
  openClipboardLinksInCurrentWindow,
} from './tab-links.js';
import { initializeNextTabsLimit } from './load-next-tabs-limit.js';

const scanButton = document.querySelector('#atlas-popup-scan');
const loadNextTabsButton = document.querySelector('#atlas-popup-load-next-tabs');
const loadNextTabsDecrementButton = document.querySelector('#atlas-popup-load-next-tabs-decrement');
const loadNextTabsIncrementButton = document.querySelector('#atlas-popup-load-next-tabs-increment');
const loadNextTabsLimitInput = document.querySelector('#atlas-popup-load-next-tabs-limit');
const copyTabLinksButton = document.querySelector('#atlas-popup-copy-tab-links');
const openClipboardLinksButton = document.querySelector('#atlas-popup-open-clipboard-links');
const reloadButton = document.querySelector('#atlas-popup-reload');
const testEventsButton = document.querySelector('#atlas-popup-test-events');
const openOptionsButton = document.querySelector('#atlas-popup-open-options');
const actionStatusElement = document.querySelector('#atlas-popup-action-status');
const connectionStatusElement = document.querySelector('#atlas-popup-connection-status');
const pairingStatusElement = document.querySelector('#atlas-popup-pairing-status');

scanButton?.addEventListener('click', () => {
  void scanActiveTab();
});

loadNextTabsButton?.addEventListener('click', () => {
  void loadNextTabs();
});

copyTabLinksButton?.addEventListener('click', () => {
  void copyOpenTabLinks();
});

openClipboardLinksButton?.addEventListener('click', () => {
  void openClipboardLinks();
});

reloadButton?.addEventListener('click', () => {
  void reloadExtension();
});

testEventsButton?.addEventListener('click', () => {
  void testEventPath();
});

openOptionsButton?.addEventListener('click', () => {
  void openOptionsPage();
});

globalThis.chrome?.storage?.onChanged?.addListener?.(handleStorageChange);
globalThis.addEventListener?.('unload', () => {
  globalThis.chrome?.storage?.onChanged?.removeListener?.(handleStorageChange);
});

initializeIcons();
const nextTabsLimit = initializeNextTabsLimit({
  input: loadNextTabsLimitInput,
  decrementButton: loadNextTabsDecrementButton,
  incrementButton: loadNextTabsIncrementButton,
  onError: setActionStatus,
});
void refreshDesktopStatus();

async function scanActiveTab() {
  setBusy(true);
  setActionStatus('Scanning page...');

  const result = await requestActiveTabScan();

  setActionStatus(result.ok ? 'Scan requested' : result.error);
  setBusy(false);
}

async function loadNextTabs() {
  await nextTabsLimit.ready;
  const limit = nextTabsLimit.normalize();

  setBusy(true);
  setActionStatus(`Loading next ${limit} tabs...`);

  const result = await requestNextTabsLoad({ limit });

  setActionStatus(result.ok ? tabsLoadedMessage(result) : result.error);
  setBusy(false);
}

async function copyOpenTabLinks() {
  setBusy(true);
  setActionStatus('Copying open links...');

  const result = await copyCurrentWindowTabLinksToClipboard();

  setActionStatus(result.ok ? copiedLinksMessage(result) : result.error);
  setBusy(false);
}

async function openClipboardLinks() {
  setBusy(true);
  setActionStatus('Opening clipboard links...');

  const result = await openClipboardLinksInCurrentWindow();

  setActionStatus(result.ok ? openedLinksMessage(result) : result.error);
  setBusy(false);
}

async function reloadExtension() {
  setBusy(true);
  setActionStatus('Reloading extension...');

  const result = await requestExtensionReload();

  if (!result.ok) {
    setActionStatus(result.error);
    setBusy(false);
  }
}

async function testEventPath() {
  setBusy(true);
  setActionStatus('Testing Desktop → background → active tab...');

  try {
    const result = await sendRuntimeMessage({ type: 'atlas-extension.desktop.test-event-path' });
    setActionStatus(result?.desktop?.accepted && result?.desktop?.emitted
      && result?.background?.received && result?.content?.acknowledged && result?.content?.applied
      ? 'Event path passed: Desktop emitted, background received, and the active tab applied it'
      : 'Event path was incomplete');
  } catch (error) {
    setActionStatus(error?.message ?? 'Event path test failed');
  } finally {
    setBusy(false);
  }
}

async function openOptionsPage() {
  setBusy(true);
  setActionStatus('Opening options...');

  const result = await openExtensionOptions();

  setActionStatus(result.ok ? 'Options opened' : result.error);
  setBusy(false);
}

async function refreshDesktopStatus() {
  try {
    renderDesktopStatus(describeDesktopStatus(await requestDesktopDiagnostics()));
  } catch {
    renderDesktopStatus(describeDesktopStatus(null));
    setActionStatus('Desktop status is unavailable.');
  }
}

function handleStorageChange(changes, areaName) {
  if (areaName === 'local' && changes?.[desktopConnectionStorageKey]) {
    void refreshDesktopStatus();
  }
}

function renderDesktopStatus(status) {
  if (connectionStatusElement !== null) {
    connectionStatusElement.textContent = status.connectionLabel;
    connectionStatusElement.dataset.state = status.connected ? 'connected' : 'disconnected';
  }

  if (pairingStatusElement !== null) {
    pairingStatusElement.textContent = status.pairingLabel;
    pairingStatusElement.dataset.state = status.pairingLabel === 'Paired'
      ? 'paired'
      : status.pairingLabel === 'Pairing…' ? 'pairing' : 'unpaired';
  }
}

function initializeIcons() {
  const icons = {
    'copy-links': ClipboardCopy,
    decrement: Minus,
    increment: Plus,
    'load-tabs': Rows3,
    'open-links': ClipboardPaste,
    options: Settings,
    reload: RefreshCw,
    scan: ScanSearch,
    'test-events': Activity,
  };

  for (const element of document.querySelectorAll('[data-atlas-popup-icon]')) {
    const icon = icons[element.dataset.atlasPopupIcon];

    if (icon) {
      render(h(icon, { size: 16, strokeWidth: 2 }), element);
    }
  }
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    globalThis.chrome?.runtime?.sendMessage?.(message, (response) => {
      const error = globalThis.chrome?.runtime?.lastError?.message;
      if (error) return reject(new Error(error));
      if (response?.ok === false) return reject(new Error(response.error?.message ?? response.error));
      resolve(response?.payload ?? {});
    });
  });
}

function setBusy(isBusy) {
  for (const control of [
    scanButton,
    loadNextTabsButton,
    loadNextTabsDecrementButton,
    loadNextTabsIncrementButton,
    loadNextTabsLimitInput,
    copyTabLinksButton,
    openClipboardLinksButton,
    reloadButton,
    testEventsButton,
    openOptionsButton,
  ]) {
    if (control !== null) {
      control.disabled = isBusy;
    }
  }
}

function setActionStatus(message) {
  if (actionStatusElement !== null) {
    actionStatusElement.textContent = message;
  }
}

function tabsLoadedMessage(result) {
  const activated = Number(result?.activated) || 0;
  const reloaded = Number(result?.reloaded) || 0;

  if (activated === 0 && reloaded === 0) {
    return 'No tabs to load';
  }

  if (reloaded > 0) {
    return reloaded === 1 ? 'Reloaded 1 tab' : `Reloaded ${reloaded} tabs`;
  }

  return activated === 1 ? 'Loaded 1 tab' : `Loaded ${activated} tabs`;
}

function copiedLinksMessage(result) {
  const copied = Number(result?.copied) || 0;
  const skipped = Number(result?.skipped) || 0;
  const message = copied === 1 ? 'Copied 1 link' : `Copied ${copied} links`;

  return skipped > 0 ? `${message}; skipped ${skipped}` : message;
}

function openedLinksMessage(result) {
  const opened = Number(result?.opened) || 0;
  const skipped = Number(result?.skipped) || 0;
  const message = opened === 1 ? 'Opened 1 link' : `Opened ${opened} links`;

  return skipped > 0 ? `${message}; skipped ${skipped}` : message;
}
