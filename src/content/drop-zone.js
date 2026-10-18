import { fetchAssetStatusesViaBackground, postAssetReactionViaBackground } from './background-api.js';
import { containedMediaFor, describeDragSource, dropEffectFor, isWindowExit, submitDroppedItem } from './drop-zone-model.js';
import { createDropReactionPicker } from './drop-zone-picker.js';
import { getDropZoneStyles } from './drop-zone-styles.js';
import { createOverlayRoot } from './overlay-host.js';
import { reactionOptions } from './reaction-options.js';

export const dropZoneHostId = 'atlas-extension-drop-zone';
const toastDurationMs = 4000;
const pointerMemoryMs = 3000;
// lucide "download" icon paths. Built with DOM APIs (no innerHTML) so pages
// enforcing Trusted Types cannot block the overlay.
const downloadIconPaths = ['M12 15V3', 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'm7 10 5 5 5-5'];
const svgNamespace = 'http://www.w3.org/2000/svg';
const kindLabels = { audio: 'Audio', file: 'File', image: 'Image', link: 'Link', video: 'Video' };
const reactionLabels = Object.fromEntries(reactionOptions.map(option => [option.type, option.label]));

// Universal fallback for assets Atlas's badges do not cover. Shown only while
// the page drags an image, media or link; it never cancels or rewrites page
// drag events, and only drops onto the box itself are consumed. Alt+drag makes
// a non-draggable element (a <video>, or an overlay above media) draggable for
// that gesture only.
export function initializeDropZone({
  documentContext = document,
  windowContext = window,
  submit,
  pickerTimeoutMs,
} = {}) {
  let session = null;
  let ui = null;
  let toastTimer = null;
  let pointer = null;
  let altDraggable = null;
  submit ??= (item, { onSaving } = {}) => submitDroppedItem(item, {
    onSaving,
    chooseReaction: ({ statePromise }) => {
      ensureUi().toast.hidden = true;
      return ui.picker.choose({ item, statePromise });
    },
    fetchStatuses: fetchAssetStatusesViaBackground,
    locationContext: windowContext.location,
    post: postAssetReactionViaBackground,
  });

  const listen = (type, listener, options) => windowContext.addEventListener(type, listener, options);
  listen('mousedown', (event) => {
    restoreAltDraggable();
    if (event.button !== 0) return;
    pointer = { x: event.clientX, y: event.clientY, at: Date.now() };
    if (event.altKey) enableAltDrag(event);
  }, true);
  listen('mouseup', () => restoreAltDraggable(), true);
  listen('dragstart', (event) => {
    if (event.defaultPrevented) return;
    const point = pointer && Date.now() - pointer.at < pointerMemoryMs ? pointer : { x: event.clientX, y: event.clientY };
    const item = describeDragSource(event.target, { documentContext, locationContext: windowContext.location, point });
    session = item;
    if (item) show(item);
    else hide();
  });
  listen('dragenter', () => { if (session && ui?.box.hidden) ui.box.hidden = false; }, true);
  listen('dragleave', (event) => { if (session && isWindowExit(event, windowContext)) hide(); }, true);
  listen('drop', (event) => { if (!ui || !event.composedPath().includes(ui.box)) end(); }, true);
  listen('dragend', end, true);
  listen('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (session) end();
    else if (ui?.picker.isOpen()) ui.picker.dismiss();
  }, true);

  function enableAltDrag(event) {
    const stack = documentContext.elementsFromPoint?.(event.clientX, event.clientY) ?? [];
    const top = stack[0];
    // Atlas's own badge is the UI for that asset; never hijack it.
    if (top?.closest?.('[data-atlas-extension-badge-host]')) return;
    const hasAsset = stack.some(element => ['AUDIO', 'IMG', 'VIDEO'].includes(String(element.tagName).toUpperCase()))
      || Boolean(top && containedMediaFor(top));
    if (!top || !hasAsset || top.draggable === true) return;
    altDraggable = { element: top, previous: top.getAttribute('draggable') };
    top.setAttribute('draggable', 'true');
  }

  function restoreAltDraggable() {
    if (!altDraggable) return;
    const { element, previous } = altDraggable;
    altDraggable = null;
    if (previous === null) element.removeAttribute('draggable');
    else element.setAttribute('draggable', previous);
  }

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
    const picker = createDropReactionPicker({ root, documentContext, windowContext, timeoutMs: pickerTimeoutMs });
    ui = { box, toast, picker };
    return ui;
  }

  function accept(event) {
    if (!session) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = dropEffectFor(event.dataTransfer.effectAllowed);
    ui.box.classList.add('is-over');
  }

  function show(item) {
    const { box, toast } = ensureUi();
    toast.hidden = true;
    const unsupported = Boolean(item.unsupported);
    const streamed = item.asset?.streamFallback === true;
    box.querySelector('.atlas-drop-zone-title').textContent = unsupported
      ? `Can't save this ${kindLabels[item.kind]?.toLowerCase() ?? 'item'}`
      : streamed ? 'Drop to save the page video' : 'Drop to save to Atlas';
    box.querySelector('.atlas-drop-zone-kind').textContent = kindLabels[item.kind] ?? item.kind;
    box.querySelector('.atlas-drop-zone-detail').textContent = unsupported ? unsupportedMessage(item)
      : streamed ? `Streamed video · Atlas saves it from ${hostOf(item.asset.source)} via yt-dlp` : item.label;
    box.setAttribute('data-atlas-drop-kind', item.kind);
    box.setAttribute('data-atlas-drop-state', unsupported ? 'unsupported' : streamed ? 'stream-fallback' : 'ready');
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
    if (item.unsupported) {
      notify('error', `${unsupportedMessage(item)} Nothing was sent to Atlas.`);
      return;
    }
    try {
      const saving = item.asset?.streamFallback === true ? 'Saving the page video via Atlas…' : `Saving ${item.label} to Atlas…`;
      const result = await submit(item, { onSaving: () => notify('pending', saving) });
      if (result?.skipped === 'blacklisted') {
        notify('error', 'This item is blacklisted in Atlas and was not downloaded.');
        return;
      }
      const status = result?.download?.status;
      const reaction = reactionLabels[result?.reactionType] ?? 'Saved';
      notify('success', status === 'queued' || status === 'completed' || status === 'downloading'
        ? `Download ${status === 'queued' ? 'queued' : status} in Atlas · ${reaction} · ${item.label}`
        : `Saved to Atlas · ${reaction} · ${item.label}`);
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

function unsupportedMessage(item) {
  const kind = kindLabels[item.kind]?.toLowerCase() ?? 'item';
  return item.unsupported === 'stream'
    ? `This ${kind} plays from a browser stream (blob:, data: or MediaSource) with no downloadable URL, and only videos can be saved from the page.`
    : `This ${kind} has no source URL to download.`;
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return 'the page';
  }
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
