import './style.css';
import { requestNextTabsLoad } from './load-next-tabs.js';
import { requestExtensionReload } from './reload-extension.js';
import { requestActiveTabScan } from './scan-active-tab.js';

const scanButton = document.querySelector('#atlas-popup-scan');
const loadNextTabsButton = document.querySelector('#atlas-popup-load-next-tabs');
const reloadButton = document.querySelector('#atlas-popup-reload');
const statusElement = document.querySelector('#atlas-popup-status');

scanButton?.addEventListener('click', () => {
  void scanActiveTab();
});

loadNextTabsButton?.addEventListener('click', () => {
  void loadNextTabs();
});

reloadButton?.addEventListener('click', () => {
  void reloadExtension();
});

async function scanActiveTab() {
  setBusy(true);
  setStatus('Scanning page...');

  const result = await requestActiveTabScan();

  setStatus(result.ok ? 'Scan requested' : result.error);
  setBusy(false);
}

async function loadNextTabs() {
  setBusy(true);
  setStatus('Loading next tabs...');

  const result = await requestNextTabsLoad();

  setStatus(result.ok ? tabsLoadedMessage(result.activated) : result.error);
  setBusy(false);
}

async function reloadExtension() {
  setBusy(true);
  setStatus('Reloading extension...');

  const result = await requestExtensionReload();

  if (!result.ok) {
    setStatus(result.error);
    setBusy(false);
  }
}

function setBusy(isBusy) {
  for (const button of [scanButton, loadNextTabsButton, reloadButton]) {
    if (button !== null) {
      button.disabled = isBusy;
    }
  }
}

function setStatus(message) {
  if (statusElement !== null) {
    statusElement.textContent = message;
  }
}

function tabsLoadedMessage(count) {
  if (count === 0) {
    return 'No tabs to load';
  }

  return count === 1 ? 'Loaded 1 tab' : `Loaded ${count} tabs`;
}
