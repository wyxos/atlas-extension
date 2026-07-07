import './style.css';
import { requestNextTabsLoad } from './load-next-tabs.js';
import { requestExtensionReload } from './reload-extension.js';
import { requestActiveTabScan } from './scan-active-tab.js';
import {
  copyCurrentWindowTabLinksToClipboard,
  openClipboardLinksInCurrentWindow,
} from './tab-links.js';
import {
  loadNextTabsDefaultLimit,
  normalizeLoadNextTabsLimit,
  stepLoadNextTabsLimit,
} from '../shared/load-next-tabs-messages.js';
import {
  readReactionWidgetVisibility,
  toggleReactionWidgetVisibility,
} from '../shared/reaction-widget-visibility.js';

const scanButton = document.querySelector('#atlas-popup-scan');
const loadNextTabsButton = document.querySelector('#atlas-popup-load-next-tabs');
const loadNextTabsDecrementButton = document.querySelector('#atlas-popup-load-next-tabs-decrement');
const loadNextTabsIncrementButton = document.querySelector('#atlas-popup-load-next-tabs-increment');
const loadNextTabsLimitInput = document.querySelector('#atlas-popup-load-next-tabs-limit');
const copyTabLinksButton = document.querySelector('#atlas-popup-copy-tab-links');
const openClipboardLinksButton = document.querySelector('#atlas-popup-open-clipboard-links');
const reloadButton = document.querySelector('#atlas-popup-reload');
const reactionWidgetVisibilityButton = document.querySelector('#atlas-popup-reaction-widget-visibility');
const statusElement = document.querySelector('#atlas-popup-status');
let reactionWidgetVisible = true;

scanButton?.addEventListener('click', () => {
  void scanActiveTab();
});

loadNextTabsDecrementButton?.addEventListener('click', () => {
  stepNextTabsLimit(-1);
});

loadNextTabsIncrementButton?.addEventListener('click', () => {
  stepNextTabsLimit(1);
});

loadNextTabsLimitInput?.addEventListener('blur', () => {
  normalizeNextTabsLimitInput();
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

reactionWidgetVisibilityButton?.addEventListener('click', () => {
  void toggleReactionWidget();
});

reloadButton?.addEventListener('click', () => {
  void reloadExtension();
});

initializeNextTabsLimit();
void initializeReactionWidgetVisibility();

async function scanActiveTab() {
  setBusy(true);
  setStatus('Scanning page...');

  const result = await requestActiveTabScan();

  setStatus(result.ok ? 'Scan requested' : result.error);
  setBusy(false);
}

async function loadNextTabs() {
  const limit = normalizeNextTabsLimitInput();

  setBusy(true);
  setStatus(`Loading next ${limit} tabs...`);

  const result = await requestNextTabsLoad({ limit });

  setStatus(result.ok ? tabsLoadedMessage(result) : result.error);
  setBusy(false);
}

async function copyOpenTabLinks() {
  setBusy(true);
  setStatus('Copying open links...');

  const result = await copyCurrentWindowTabLinksToClipboard();

  setStatus(result.ok ? copiedLinksMessage(result) : result.error);
  setBusy(false);
}

async function openClipboardLinks() {
  setBusy(true);
  setStatus('Opening clipboard links...');

  const result = await openClipboardLinksInCurrentWindow();

  setStatus(result.ok ? openedLinksMessage(result) : result.error);
  setBusy(false);
}

async function toggleReactionWidget() {
  setBusy(true);
  setStatus(`${reactionWidgetVisible ? 'Hiding' : 'Showing'} reaction widget...`);

  reactionWidgetVisible = await toggleReactionWidgetVisibility();
  renderReactionWidgetVisibility();
  setStatus(reactionWidgetVisible ? 'Reaction widget shown' : 'Reaction widget hidden');
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
  for (const control of [
    scanButton,
    loadNextTabsButton,
    loadNextTabsDecrementButton,
    loadNextTabsIncrementButton,
    loadNextTabsLimitInput,
    copyTabLinksButton,
    openClipboardLinksButton,
    reactionWidgetVisibilityButton,
    reloadButton,
  ]) {
    if (control !== null) {
      control.disabled = isBusy;
    }
  }
}

function setStatus(message) {
  if (statusElement !== null) {
    statusElement.textContent = message;
  }
}

function tabsLoadedMessage(result) {
  const activated = Number(result?.activated) || 0;
  const reloaded = Number(result?.reloaded) || 0;

  if (activated === 0 && reloaded === 0) {
    return 'No tabs to load';
  }

  if (activated === 0) {
    return reloaded === 1 ? 'Reloaded 1 tab' : `Reloaded ${reloaded} tabs`;
  }

  const loadedMessage = activated === 1 ? 'Loaded 1 tab' : `Loaded ${activated} tabs`;

  if (reloaded === 0) {
    return loadedMessage;
  }

  const reloadedMessage = reloaded === 1 ? 'reloaded 1 tab' : `reloaded ${reloaded} tabs`;

  return `${loadedMessage} and ${reloadedMessage}`;
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

function initializeNextTabsLimit() {
  if (loadNextTabsLimitInput !== null) {
    loadNextTabsLimitInput.value = String(loadNextTabsDefaultLimit);
  }
}

function normalizeNextTabsLimitInput() {
  const limit = normalizeLoadNextTabsLimit(loadNextTabsLimitInput?.value);

  if (loadNextTabsLimitInput !== null) {
    loadNextTabsLimitInput.value = String(limit);
  }

  return limit;
}

function stepNextTabsLimit(delta) {
  const limit = stepLoadNextTabsLimit(loadNextTabsLimitInput?.value, delta);

  if (loadNextTabsLimitInput !== null) {
    loadNextTabsLimitInput.value = String(limit);
  }
}

async function initializeReactionWidgetVisibility() {
  reactionWidgetVisible = await readReactionWidgetVisibility();
  renderReactionWidgetVisibility();
}

function renderReactionWidgetVisibility() {
  if (reactionWidgetVisibilityButton === null) {
    return;
  }

  reactionWidgetVisibilityButton.textContent = reactionWidgetVisible
    ? 'Hide reaction widget'
    : 'Show reaction widget';
  reactionWidgetVisibilityButton.setAttribute('aria-pressed', String(!reactionWidgetVisible));
}
