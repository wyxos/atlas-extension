import { getAssetTarget } from './assets.js';
import { resolveCurrentReaction } from './reaction-download-action.js';

// Atlas Desktop's reaction contract is the only Desktop path that saves and
// downloads a browser asset, and it requires a reaction type
// (atlas-desktop src-tauri/src/extension_assets/reaction.rs validate_reaction).
// The drop zone has no rating step yet, so a new item is saved as Like and an
// existing Library reaction is kept unchanged.
export const dropZoneReactionType = 'like';
export const dropZoneCaptureMethod = 'drop-zone';

const pageExtensions = new Set(['asp', 'aspx', 'cfm', 'cgi', 'htm', 'html', 'jsp', 'php', 'shtml', 'xhtml']);
const maxTextLength = 1000;

export function describeDragSource(target, { documentContext, locationContext, resolveImageTarget = getAssetTarget } = {}) {
  const element = target?.nodeType === 1 ? target : target?.parentElement ?? null;
  if (!element || typeof element.closest !== 'function') return null;
  const image = String(element.tagName).toUpperCase() === 'IMG' ? element : null;
  const anchor = element.closest('a[href]');
  const elementUrl = anchor ? httpUrl(anchor.href ?? anchor.getAttribute('href')) : null;
  const page = {
    pageTitle: text(documentContext?.title),
    pageUrl: httpUrl(locationContext?.href) ?? undefined,
    captureMethod: dropZoneCaptureMethod,
  };

  if (image) {
    const target = safeImageTarget(image, resolveImageTarget, locationContext);
    const source = httpUrl(target?.source) ?? httpUrl(image.currentSrc) ?? httpUrl(image.src);
    if (!source) return null;
    const filename = filenameFromUrl(source);
    return item('image', filename ?? text(image.getAttribute('alt')) ?? 'Image', {
      ...page,
      altText: text(image.getAttribute('alt')),
      elementUrl: elementUrl ?? undefined,
      filename,
      resolution: target?.resolution ?? dimensions(image),
      source,
      titleText: text(image.getAttribute('title')),
      type: 'image',
    });
  }

  if (!elementUrl) return null;
  const downloadName = anchor.hasAttribute('download') ? text(anchor.getAttribute('download')) : undefined;
  const kind = anchor.hasAttribute('download') || isFileLink(elementUrl) ? 'file' : 'link';
  const filename = downloadName ?? (kind === 'file' ? filenameFromUrl(elementUrl) : undefined);
  const linkText = text(anchor.textContent);
  return item(kind, filename ?? linkText ?? elementUrl, {
    ...page,
    elementUrl,
    filename,
    linkText,
    source: elementUrl,
    titleText: text(anchor.getAttribute('title')),
    type: kind,
  });
}

export async function submitDroppedItem(dropped, {
  fetchStatuses,
  locationContext,
  post,
}) {
  const { asset } = dropped;
  let state = {};
  try {
    state = (await fetchStatuses({ assetUrls: [asset.source] }))?.assets?.[asset.source] ?? {};
  } catch {
    // Status is advisory: Desktop validates the reaction itself.
  }
  const current = resolveCurrentReaction(state);
  if (current === 'blacklist') return { skipped: 'blacklisted' };
  return post({
    asset,
    reactionType: current ?? dropZoneReactionType,
    referrerUrl: locationContext.href,
    source: locationContext.hostname,
    timeoutMs: 30000,
  });
}

export function isFileLink(url) {
  try {
    const name = new URL(url).pathname.split('/').at(-1) ?? '';
    const extension = /\.([a-z0-9]{1,8})$/i.exec(name)?.[1]?.toLowerCase();
    return Boolean(extension) && !pageExtensions.has(extension);
  } catch {
    return false;
  }
}

export function dropEffectFor(effectAllowed) {
  const allowed = String(effectAllowed ?? 'all');
  if (['all', 'uninitialized', 'copy', 'copyLink', 'copyMove'].includes(allowed)) return 'copy';
  if (['link', 'linkMove'].includes(allowed)) return 'link';
  return allowed === 'move' ? 'move' : 'copy';
}

// Chromium reports a null relatedTarget at the viewport edge when the pointer
// leaves the window; internal dragleave events always name the next element.
export function isWindowExit(event, view) {
  if (event.relatedTarget) return false;
  const { clientX: x, clientY: y } = event;
  return x <= 0 || y <= 0 || x >= view.innerWidth || y >= view.innerHeight;
}

function item(kind, label, asset) {
  return {
    asset: Object.fromEntries(Object.entries(asset).filter(([, value]) => value !== undefined && value !== null)),
    kind,
    label,
  };
}

function safeImageTarget(image, resolveImageTarget, locationContext) {
  try {
    return resolveImageTarget(image, { siteDomain: locationContext?.hostname });
  } catch {
    return null;
  }
}

function dimensions(image) {
  const width = Number(image.naturalWidth ?? 0);
  const height = Number(image.naturalHeight ?? 0);
  return width > 0 && height > 0 ? `${width}x${height}` : undefined;
}

function filenameFromUrl(url) {
  try {
    const name = decodeURIComponent(new URL(url).pathname.split('/').at(-1) ?? '');
    return text(name);
  } catch {
    return undefined;
  }
}

function text(value) {
  const normalized = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return normalized === '' ? undefined : normalized.slice(0, maxTextLength);
}

function httpUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  try {
    const url = new URL(value.trim());
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}
