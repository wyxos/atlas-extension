import './style.css';
import { requestExtensionReload } from './reload-extension.js';
import { requestActiveTabScan } from './scan-active-tab.js';

const scanButton = document.querySelector('#atlas-popup-scan');
const reloadButton = document.querySelector('#atlas-popup-reload');
const statusElement = document.querySelector('#atlas-popup-status');

scanButton?.addEventListener('click', () => {
  void scanActiveTab();
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
  for (const button of [scanButton, reloadButton]) {
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
