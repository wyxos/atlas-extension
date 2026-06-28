import './style.css';
import { requestActiveTabScan } from './scan-active-tab.js';

const scanButton = document.querySelector('#atlas-popup-scan');
const statusElement = document.querySelector('#atlas-popup-status');

scanButton?.addEventListener('click', () => {
  void scanActiveTab();
});

async function scanActiveTab() {
  setBusy(true);
  setStatus('Scanning page...');

  const result = await requestActiveTabScan();

  setStatus(result.ok ? 'Scan requested' : result.error);
  setBusy(false);
}

function setBusy(isBusy) {
  if (scanButton !== null) {
    scanButton.disabled = isBusy;
  }
}

function setStatus(message) {
  if (statusElement !== null) {
    statusElement.textContent = message;
  }
}
