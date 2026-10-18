import { getAssetTarget } from './assets.js';
import { resolveCurrentReaction } from './reaction-download-action.js';

// Atlas Desktop's reaction contract is the only Desktop path that saves and
// downloads a browser asset, and it requires a reaction type
// (atlas-desktop src-tauri/src/extension_assets/reaction.rs validate_reaction).
// The post-drop picker defaults to Like.
export const dropZoneReactionType = 'like';
export const dropZoneReactionTypes = Object.freeze(['love', 'like', 'funny', 'blacklist']);
export const dropZoneCaptureMethod = 'drop-zone';

const pageExtensions = new Set(['asp', 'aspx', 'cfm', 'cgi', 'htm', 'html', 'jsp', 'php', 'shtml', 'xhtml']);
const videoExtensions = new Set(['3gp', 'avi', 'flv', 'm3u8', 'm4v', 'mkv', 'mov', 'mp4', 'mpd', 'mpeg', 'mpg', 'ogv', 'ts', 'webm', 'wmv']);
const audioExtensions = new Set(['aac', 'aif', 'aiff', 'alac', 'flac', 'm4a', 'mid', 'midi', 'mp3', 'oga', 'ogg', 'opus', 'wav', 'weba', 'wma']);
const mediaTags = new Set(['AUDIO', 'VIDEO']);
const maxTextLength = 1000;

// Resolves what the user is dragging. A drag that starts on an overlay (an
// empty link, a draggable wrapper, or Alt+drag on any element) resolves the
// video, audio or image stacked underneath via elementsFromPoint.
export function describeDragSource(target, {
  documentContext,
  locationContext,
  point = null,
  elementsFromPoint = (x, y) => documentContext?.elementsFromPoint?.(x, y) ?? [],
  resolveImageTarget = getAssetTarget,
} = {}) {
  const element = target?.nodeType === 1 ? target : target?.parentElement ?? null;
  if (!element || typeof element.closest !== 'function') return null;
  const anchor = element.closest('a[href]');
  const elementUrl = anchor ? httpUrl(anchor.href ?? anchor.getAttribute('href')) : null;
  const page = {
    pageTitle: text(documentContext?.title),
    pageUrl: httpUrl(locationContext?.href) ?? undefined,
    captureMethod: dropZoneCaptureMethod,
  };
  const context = { documentContext, elementUrl, locationContext, page, resolveImageTarget };

  const media = mediaElementFor(element);
  if (media) return describeMedia(media, context);
  if (tagOf(element) === 'IMG') return describeImage(element, context);

  // Text links keep their meaning; only text-less overlays and non-link
  // draggables fall through to what is underneath.
  const linkText = anchor ? text(anchor.textContent) : undefined;
  if (!anchor || !linkText) {
    const underneath = point ? [...elementsFromPoint(point.x, point.y)]
      .find(candidate => mediaTags.has(tagOf(candidate)) || tagOf(candidate) === 'IMG' || isPlayerFrame(candidate)) : null;
    if (underneath) {
      if (tagOf(underneath) === 'IFRAME') return describeEmbed(underneath, context);
      return mediaTags.has(tagOf(underneath))
        ? describeMedia(underneath, context)
        : describeImage(underneath, context);
    }
    // Custom players hide their <audio>/<video> (no native controls) inside
    // a widget; a drag from the widget resolves its single media element.
    const contained = containedMediaFor(element);
    if (contained) return describeMedia(contained, context);
  }

  if (!elementUrl) return null;
  const downloadName = anchor.hasAttribute('download') ? text(anchor.getAttribute('download')) : undefined;
  const mimeType = text(anchor.getAttribute('type'))?.toLowerCase();
  const kind = linkKind(elementUrl, mimeType, anchor.hasAttribute('download'));
  const filename = downloadName ?? (kind === 'link' ? undefined : filenameFromUrl(elementUrl));
  return item(kind, filename ?? linkText ?? elementUrl, {
    ...page,
    elementUrl,
    filename,
    linkText,
    mimeType,
    source: elementUrl,
    titleText: text(anchor.getAttribute('title')),
    type: kind,
  });
}

// Final reaction for a drop. An explicit pick always wins (except
// re-blacklisting); otherwise an existing reaction is kept, blacklisted items
// are not downloaded again, and new items default to Like.
export function resolveDropReaction({ state = {}, picked = null } = {}) {
  const current = resolveCurrentReaction(state ?? {});
  if (dropZoneReactionTypes.includes(picked)) {
    return picked === 'blacklist' && current === 'blacklist'
      ? { skipped: 'blacklisted' }
      : { reactionType: picked, current, explicit: true };
  }
  if (current === 'blacklist') return { skipped: 'blacklisted' };
  return { reactionType: current ?? dropZoneReactionType, current, explicit: false };
}

// One Desktop request per drop, sent after the picker settles (see
// docs/DROP_ZONE.md for why the extension does not send Like first).
export async function submitDroppedItem(dropped, {
  chooseReaction = async () => null,
  fetchStatuses,
  locationContext,
  onSaving = () => {},
  post,
}) {
  const { asset } = dropped;
  const statePromise = Promise.resolve()
    .then(() => fetchStatuses({ assetUrls: [asset.source] }))
    .then(response => response?.assets?.[asset.source] ?? {})
    // Status is advisory: Desktop validates the reaction itself.
    .catch(() => ({}));
  const picked = await chooseReaction({ statePromise });
  const decision = resolveDropReaction({ state: await statePromise, picked });
  if (decision.skipped) return decision;
  onSaving(decision);
  const result = await post({
    asset,
    reactionType: decision.reactionType,
    referrerUrl: dropped.referrerUrl ?? locationContext.href,
    source: locationContext.hostname,
    timeoutMs: 30000,
  });
  return { ...result, reactionType: decision.reactionType };
}

export function isFileLink(url) {
  const extension = urlExtension(url);
  return Boolean(extension) && !pageExtensions.has(extension);
}

export function mediaKindForUrl(url, mimeType) {
  const type = String(mimeType ?? '').toLowerCase();
  if (type.startsWith('video/') || ['application/x-mpegurl', 'application/vnd.apple.mpegurl', 'application/dash+xml'].includes(type)) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  const extension = urlExtension(url);
  if (videoExtensions.has(extension)) return 'video';
  if (audioExtensions.has(extension)) return 'audio';
  return null;
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

function linkKind(url, mimeType, hasDownload) {
  return mediaKindForUrl(url, mimeType) ?? (hasDownload || isFileLink(url) ? 'file' : 'link');
}

// The single <audio>/<video> inside `element` or one of its closest
// ancestors (a custom player widget), if there is exactly one.
export function containedMediaFor(element, depth = 3) {
  for (let current = element, level = 0; current && level <= depth; current = current.parentElement, level += 1) {
    if (['BODY', 'HTML'].includes(tagOf(current))) return null;
    const media = [...(current.querySelectorAll?.('audio, video') ?? [])];
    if (media.length === 1) return media[0];
    if (media.length > 1) return null;
  }
  return null;
}

function mediaElementFor(element) {
  if (mediaTags.has(tagOf(element))) return element;
  if (tagOf(element) === 'SOURCE' && mediaTags.has(tagOf(element.parentElement))) return element.parentElement;
  return null;
}

function describeImage(image, { elementUrl, locationContext, page, resolveImageTarget }) {
  const target = safeImageTarget(image, resolveImageTarget, locationContext);
  const source = httpUrl(target?.source) ?? httpUrl(image.currentSrc) ?? httpUrl(image.src);
  if (!source) return null;
  const filename = filenameFromUrl(source);
  return item('image', filename ?? text(image.getAttribute('alt')) ?? 'Image', {
    ...page,
    altText: text(image.getAttribute('alt')),
    elementUrl: elementUrl ?? undefined,
    filename,
    resolution: target?.resolution ?? dimensions(image.naturalWidth, image.naturalHeight),
    source,
    titleText: text(image.getAttribute('title')),
    type: 'image',
  });
}

// currentSrc first (what the browser plays), then <source> children, then src.
// blob:, data: and MediaStream/MSE playback have no fetchable URL.
function describeMedia(media, { documentContext, elementUrl, locationContext, page }) {
  const kind = tagOf(media) === 'AUDIO' ? 'audio' : 'video';
  const sources = [...(media.querySelectorAll?.('source') ?? [])];
  const candidates = [media.currentSrc, ...sources.map(source => source.src || source.getAttribute('src')), media.src || media.getAttribute('src')]
    .filter(value => typeof value === 'string' && value.trim() !== '');
  const source = candidates.map(httpUrl).find(Boolean);
  const label = text(media.getAttribute('title')) ?? text(media.getAttribute('aria-label'));
  if (!source) {
    const stream = media.srcObject || candidates.some(value => /^(blob|data|mediastream):/i.test(value.trim()));
    const pageUrl = stream && kind === 'video' ? canonicalPageUrl(documentContext, locationContext) : null;
    if (pageUrl) return describeStreamFallback(media, pageUrl, { elementUrl, label, page });
    return {
      asset: null, kind, label: label ?? (kind === 'audio' ? 'Audio' : 'Video'),
      unsupported: stream ? 'stream' : 'no-source',
    };
  }
  const chosen = sources.find(entry => httpUrl(entry.src || entry.getAttribute('src')) === source);
  const filename = filenameFromUrl(source);
  return item(kind, filename ?? label ?? kind, {
    ...page,
    duration: Number.isFinite(media.duration) && media.duration > 0 ? Math.round(media.duration * 1000) / 1000 : undefined,
    elementUrl: elementUrl ?? undefined,
    filename,
    mimeType: text(chosen?.getAttribute('type'))?.toLowerCase(),
    posterUrl: kind === 'video' ? httpUrl(media.poster || media.getAttribute('poster')) ?? undefined : undefined,
    resolution: kind === 'video' ? dimensions(media.videoWidth, media.videoHeight) : undefined,
    source,
    titleText: text(media.getAttribute('title')),
    type: kind,
  });
}

// Streamed playback (MSE blob:, MediaStream) has no fetchable media URL.
// Like the badges' media page fallback (assets.js getAssetTarget), the page is
// saved as a `video`: Desktop routes video assets to yt-dlp and downloads
// top_page_url → referrer_url → asset_url (atlas-desktop
// src-tauri/src/downloads/engine.rs, downloads/model.rs source_type).
function describeStreamFallback(media, pageUrl, { elementUrl, label, page }) {
  return item('video', label ?? `Page video · ${hostOf(pageUrl)}`, {
    ...page,
    duration: Number.isFinite(media.duration) && media.duration > 0 ? Math.round(media.duration * 1000) / 1000 : undefined,
    elementUrl: elementUrl ?? undefined,
    posterUrl: httpUrl(media.poster || media.getAttribute('poster')) ?? undefined,
    resolution: dimensions(media.videoWidth, media.videoHeight),
    source: pageUrl,
    streamFallback: true,
    titleText: text(media.getAttribute('title')),
    type: 'video',
  });
}

// A text-less overlay above a cross-origin player iframe: the embed page is
// what yt-dlp can resolve, so it is both the asset and the referrer (Desktop
// starts yt-dlp at referrer_url when no top_page_url is set).
function describeEmbed(frame, { elementUrl, page }) {
  const embedUrl = httpUrl(frame.src || frame.getAttribute('src'));
  return {
    ...item('video', text(frame.getAttribute('title')) ?? `Embedded video · ${hostOf(embedUrl)}`, {
      ...page,
      elementUrl: elementUrl ?? undefined,
      embedUrl,
      source: embedUrl,
      streamFallback: true,
      titleText: text(frame.getAttribute('title')),
      type: 'video',
    }),
    referrerUrl: embedUrl,
  };
}

// Player iframes declare fullscreen/autoplay/encrypted-media; ads and widgets
// without those are ignored.
function isPlayerFrame(element) {
  if (tagOf(element) !== 'IFRAME' || !httpUrl(element.src || element.getAttribute?.('src'))) return false;
  const allow = String(element.getAttribute?.('allow') ?? '').toLowerCase();
  return element.hasAttribute?.('allowfullscreen') || /\b(autoplay|encrypted-media|fullscreen)\b/.test(allow);
}

// Canonical page URL for a page-level video save: <link rel=canonical>, then
// og:url, then location.href. A declared URL is used only on the same site
// (same host, ignoring www., or a subdomain of it) so a page cannot point
// the save at an unrelated origin; Desktop still starts yt-dlp at the
// referrer (location.href).
export function canonicalPageUrl(documentContext, locationContext) {
  const href = httpUrl(locationContext?.href);
  if (!href) return null;
  const declared = [
    documentContext?.querySelector?.('link[rel~="canonical"][href]')?.getAttribute('href'),
    documentContext?.querySelector?.('meta[property="og:url"][content]')?.getAttribute('content'),
  ];
  for (const value of declared) {
    const url = httpUrl(resolveUrl(value, href));
    if (url && sameSite(url, href)) return url;
  }
  return href;
}

function resolveUrl(value, base) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  try {
    return new URL(value.trim(), base).href;
  } catch {
    return null;
  }
}

function sameSite(left, right) {
  const host = (value) => new URL(value).hostname.toLowerCase().replace(/^www\./, '');
  const [a, b] = [host(left), host(right)];
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return 'page';
  }
}

function item(kind, label, asset) {
  return {
    asset: Object.fromEntries(Object.entries(asset).filter(([, value]) => value !== undefined && value !== null)),
    kind,
    label,
  };
}

function tagOf(element) {
  return String(element?.tagName ?? '').toUpperCase();
}

function safeImageTarget(image, resolveImageTarget, locationContext) {
  try {
    return resolveImageTarget(image, { siteDomain: locationContext?.hostname });
  } catch {
    return null;
  }
}

function dimensions(width, height) {
  return Number(width) > 0 && Number(height) > 0 ? `${Number(width)}x${Number(height)}` : undefined;
}

function urlExtension(url) {
  try {
    const name = new URL(url).pathname.split('/').at(-1) ?? '';
    return /\.([a-z0-9]{1,8})$/i.exec(name)?.[1]?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

function filenameFromUrl(url) {
  try {
    return text(decodeURIComponent(new URL(url).pathname.split('/').at(-1) ?? ''));
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
