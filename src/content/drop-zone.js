import { fetchAssetStatusesViaBackground, postAssetReactionViaBackground } from './background-api.js';
import { describeDragSource, dropEffectFor, isWindowExit, submitDroppedItem } from './drop-zone-model.js';
import { getDropZoneStyles } from './drop-zone-styles.js';
import { createOverlayRoot } from './overlay-host.js';

export const dropZoneHostId = 'atlas-extension-drop-zone';
const toastDurationMs = 4000;
// lucide "download" icon paths. Built with DOM APIs (no innerHTML) so pages
// enforcing Trusted Types cannot block the overlay.
const downloadIconPaths = ['M12 15V3', 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'm7 10 5 5 5-5'];
const svgNamespace = 'http://www.w3.org/2000/svg';
const kindLabels = { file: 'File', image: 'Image', link: 'Link' };

// Shown only while the page drags an image or link. It never cancels or
// rewrites page drag events; only drops onto the box itself are consumed.
export function initializeDropZone({
  documentContext = document,
  windowContext = window,
  submit = (item) => submitDroppedItem(item, {
    fetchStatuses: fetchAssetStatusesViaBackground,
    locationContext: windowContext.location,
    post: postAssetReactionViaBackground,
  }),
} = {}) {
  let session = null;
  let ui = null;
  let toastTimer = null;

  const listen = (type, listener, options) => windowContext.addEventListener(type, listener, options);
  listen('dragstart', (event) => {
    if (event.defaultPrevented) return;
    const item = describeDragSource(event.target, { documentContext, locationContext: windowContext.location });
    session = item;
    if (item) show(item);
    else hide();
  });
  listen('dragenter', () => { if (session && ui?.box.hidden) ui.box.hidden = false; }, true);
  listen('dragleave', (event) => { if (session && isWindowExit(event, windowContext)) hide(); }, true);
  listen('drop', (event) => { if (!ui || !event.composedPath().includes(ui.box)) end(); }, true);
  listen('dragend', end, true);
  listen('keydown', (event) => { if (event.key === 'Escape' && session) end(); }, true);

  function ensureUi() {
    if (ui) return ui;
    const root = createOverlayRoot(documentContext, dropZoneHostId);
    const style = documentContext.createElement('style');
    style.textContent = getDropZoneStyles();
    const box = documentContext.createElement('div');
    box.className = 'atlas-drop-zone';
    box.setAttribute('data-atlas-drop-zone', 'true');
    box.setAttribute('role', 'region');
    box.setAttribute('aria-label', 'Drop to save to Atlas');
    box.hidden = true;
    box.append(createIcon(documentContext),
      span(documentContext, 'atlas-drop-zone-title', 'Drop to save to Atlas'),
      span(documentContext, 'atlas-drop-zone-kind'),
      span(documentContext, 'atlas-drop-zone-detail'));
    const toast = documentContext.createElement('div');
    toast.className = 'atlas-drop-zone-toast';
    toast.setAttribute('data-atlas-drop-zone-toast', 'true');
    toast.setAttribute('role', 'status');
    toast.hidden = true;
    root.append(style, box, toast);
    box.addEventListener('dragenter', accept);
    box.addEventListener('dragover', accept);
    box.addEventListener('dragleave', (event) => {
      if (!box.contains(event.relatedTarget)) box.classList.remove('is-over');
    });
    box.addEventListener('drop', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const item = session;
      end();
      if (item) void deliver(item);
    });
    ui = { box, toast };
    return ui;
  }

  function accept(event) {
    if (!session) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = dropEffectFor(event.dataTransfer.effectAllowed);
    ui.box.classList.add('is-over');
  }

  function show(item) {
    const { box } = ensureUi();
    box.querySelector('.atlas-drop-zone-kind').textContent = kindLabels[item.kind] ?? item.kind;
    box.querySelector('.atlas-drop-zone-detail').textContent = item.label;
    box.setAttribute('data-atlas-drop-kind', item.kind);
    box.classList.remove('is-over');
    box.hidden = false;
  }

  function hide() {
    if (!ui) return;
    ui.box.hidden = true;
    ui.box.classList.remove('is-over');
  }

  function end() {
    session = null;
    hide();
  }

  async function deliver(item) {
    notify('pending', `Saving ${item.label} to Atlas…`);
    try {
      const result = await submit(item);
      if (result?.skipped === 'blacklisted') {
        notify('error', 'This item is blacklisted in Atlas and was not downloaded.');
        return;
      }
      const status = result?.download?.status;
      notify('success', status === 'queued' || status === 'completed' || status === 'downloading'
        ? `Download ${status === 'queued' ? 'queued' : status} in Atlas · ${item.label}`
        : `Saved to Atlas · ${item.label}`);
    } catch (error) {
      notify('error', `Atlas could not save this item · ${error?.message ?? 'Request failed.'}`);
    }
  }

  function notify(state, message) {
    const { toast } = ensureUi();
    toast.textContent = message;
    toast.setAttribute('data-state', state);
    toast.hidden = false;
    windowContext.clearTimeout(toastTimer);
    if (state !== 'pending') toastTimer = windowContext.setTimeout(() => { toast.hidden = true; }, toastDurationMs);
  }

  return { isVisible: () => Boolean(ui && !ui.box.hidden) };
}

function span(documentContext, className, text = '') {
  const element = documentContext.createElement('span');
  element.className = className;
  element.textContent = text;
  return element;
}

function createIcon(documentContext) {
  const svg = documentContext.createElementNS(svgNamespace, 'svg');
  for (const [name, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) {
    svg.setAttribute(name, value);
  }
  for (const d of downloadIconPaths) {
    const path = documentContext.createElementNS(svgNamespace, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}
