import { galleryMedia } from './media.js';
import { samePage } from './page-scope.js';

const maxGalleryItems = 50;
const batchTimeoutMs = 60000;
const navigationTimeoutMs = 30000;
const restoreTimeoutMs = 2500;
const noOp = () => {};
const batchError = code => Object.assign(new Error(code), { code, retryable: true });

// Desktop describes a page; all bounded browser mechanics ship in the extension.
export function createThumbnailGallery(profile) {
  const spec = profile.gallery;
  function assertPage(location, assertActive = noOp) {
    assertActive();
    if (!samePage(location?.href, profile.url)) throw batchError('BATCH_POST_CHANGED');
  }
  function assertUsable(options) {
    assertPage(options.locationContext, options.assertActive);
    if (Date.now() >= options.deadline) throw batchError('BATCH_INCOMPLETE');
  }
  function resolve({ documentContext = globalThis.document, locationContext = globalThis.location } = {}) {
    if (!samePage(locationContext?.href, profile.url)) return null;
    if (findThumbnailButtons(documentContext).length < 2
      && !findNavigationButton(documentContext, spec.previousLabel)
      && !findNavigationButton(documentContext, spec.nextLabel)) return null;
    return { available: true, provider: profile.provider };
  }
  async function collect({
    documentContext = globalThis.document, locationContext = globalThis.location,
    maxItems = maxGalleryItems, waitForChange = waitForChangeDefault,
    assertActive = noOp, timeoutMs = batchTimeoutMs,
  } = {}) {
    const limit = Number.isFinite(maxItems) ? Math.max(1, Math.min(maxGalleryItems, Math.floor(maxItems))) : maxGalleryItems;
    const duration = Number.isFinite(timeoutMs) ? Math.max(0, Math.min(batchTimeoutMs, timeoutMs)) : batchTimeoutMs;
    const originalIndex = fileIndex(locationContext?.href);
    const options = { documentContext, locationContext, maxItems: limit, waitForChange, assertActive,
      deadline: Date.now() + duration, currentIndex: originalIndex, navigated: false };
    assertUsable(options);
    const buttons = findThumbnailButtons(documentContext);
    if (buttons.length > limit) throw batchError('BATCH_TOO_LARGE');
    const items = new Map();
    let failure;
    try {
      if (buttons.length > 1) {
        for (let index = 0; index < buttons.length; index += 1) {
          await selectThumbnail(index + 1, options);
          capture(items, index + 1, options);
        }
        assertUsable(options);
        if (findThumbnailButtons(documentContext).length !== buttons.length) throw batchError('BATCH_INCOMPLETE');
      } else {
        capture(items, options.currentIndex, options);
        for (const direction of [spec.previousLabel, spec.nextLabel]) {
          let steps = 0;
          while (await navigate(direction, options)) {
            steps += 1;
            capture(items, options.currentIndex, options);
            if (steps >= limit) {
              assertUsable(options);
              if (findNavigationButton(documentContext, direction)) throw batchError('BATCH_TOO_LARGE');
              break;
            }
          }
        }
      }
      assertUsable(options);
    } catch (error) { failure = error; }
    // Restore only the same active document. A cleanup error cannot replace the
    // reason collection failed; successful collection still requires restoration.
    if (options.navigated) {
      try {
        assertPage(locationContext, assertActive);
        const restoration = { ...options, deadline: Date.now() + restoreTimeoutMs };
        if (buttons.length > 1) await selectThumbnail(originalIndex, restoration);
        else await restoreIndex(originalIndex, restoration);
      } catch (error) { failure ??= error; }
    }
    if (failure) throw failure;
    assertPage(locationContext, assertActive);
    return [...items.values()].sort((left, right) => fileIndex(left.referrerUrl) - fileIndex(right.referrerUrl));
  }
  function capture(items, index, options) {
    assertUsable(options);
    const item = readCurrent({ ...options, fileIndex: index });
    if (!item) throw batchError('BATCH_INCOMPLETE');
    items.set(item.referrerUrl, item);
    if (items.size > options.maxItems) throw batchError('BATCH_TOO_LARGE');
  }
  function readCurrent({ documentContext = globalThis.document, locationContext = globalThis.location,
    fileIndex: index = fileIndex(locationContext?.href), assertActive = noOp } = {}) {
    assertPage(locationContext, assertActive);
    const image = findMainImage(documentContext);
    const media = galleryMedia(image, spec, new URL(locationContext.href));
    if (!media) return null;
    return {
      asset: { ...media, resolution: image?.complete === false ? null : media.resolution ?? naturalResolution(image),
        type: 'image', ...(profile.identity ? { providerIdentity: profile.identity } : {}) },
      referrerUrl: referrer(locationContext.href, index), source: new URL(locationContext.href).hostname,
    };
  }
  function referrer(rawUrl, index) {
    const url = new URL(rawUrl);
    if (spec.clearQuery) { url.search = ''; url.hash = ''; }
    url.searchParams.set(spec.indexParameter, String(Math.max(1, Number(index) || 1)));
    return url.href;
  }
  async function selectThumbnail(target, options) {
    assertUsable(options);
    if (options.currentIndex === target) return;
    const before = snapshot(options);
    const button = findThumbnailButtons(options.documentContext)[target - 1];
    if (!button) throw batchError('BATCH_INCOMPLETE');
    assertUsable(options);
    options.navigated = true;
    activate(button);
    options.currentIndex = target;
    await waitForChanged(before, options);
  }
  async function navigate(direction, options) {
    assertUsable(options);
    const button = findNavigationButton(options.documentContext, direction);
    if (!button) return false;
    const before = snapshot(options);
    const beforeUrl = options.locationContext?.href;
    assertUsable(options);
    options.navigated = true;
    activate(button);
    options.currentIndex = options.locationContext?.href !== beforeUrl
      ? fileIndex(options.locationContext?.href)
      : Math.max(1, options.currentIndex + (direction === spec.nextLabel ? 1 : -1));
    await waitForChanged(before, options);
    return true;
  }
  async function restoreIndex(target, options) {
    for (let step = 0; step < maxGalleryItems && options.currentIndex !== target; step += 1) {
      if (!await navigate(options.currentIndex > target ? spec.previousLabel : spec.nextLabel, options)) break;
    }
    if (options.currentIndex !== target) throw batchError('BATCH_INCOMPLETE');
  }
  async function waitForChanged(before, options) {
    assertUsable(options);
    const changed = await options.waitForChange({ before, documentContext: options.documentContext,
      locationContext: options.locationContext, assertActive: () => assertUsable(options),
      timeoutMs: Math.min(navigationTimeoutMs, Math.max(0, options.deadline - Date.now())) });
    assertUsable(options);
    if (!changed) throw batchError('BATCH_INCOMPLETE');
  }
  async function waitForChangeDefault({ before, documentContext, locationContext, assertActive,
    timeoutMs = navigationTimeoutMs, pollMs = 50 }) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      assertActive();
      await new Promise(resolve => globalThis.setTimeout(resolve, Math.min(pollMs, deadline - Date.now())));
      assertActive();
      const source = snapshot({ documentContext, locationContext, assertActive }); if (source && source !== before) return true;
    }
    return false;
  }
  function snapshot(options) { return readCurrent(options)?.asset?.source ?? ''; }
  function fileIndex(rawUrl) {
    try { const index = Number(new URL(rawUrl).searchParams.get(spec.indexParameter)); return Number.isInteger(index) && index > 0 ? index : 1; }
    catch { return 1; }
  }
  function findNavigationButton(documentContext, label) {
    return queryAll(documentContext, spec.navigationSelector).find(element =>
      element?.disabled !== true && element?.getAttribute?.('aria-disabled') !== 'true'
      && element?.getAttribute?.('aria-label') === label && visible(element)) ?? null;
  }
  function findThumbnailButtons(documentContext) {
    const seen = new Set();
    const buttons = [];
    for (const image of queryAll(documentContext, spec.thumbnailSelector)) {
      const button = image?.closest?.(spec.thumbnailButtonSelector);
      const container = image?.closest?.(spec.thumbnailContainerSelector);
      if (!button || seen.has(button) || !visible(button) || !visible(image)
        || !galleryMedia(image, spec, new URL(profile.url))
        || !String(container?.textContent ?? '').toLowerCase().includes(spec.thumbnailContainerText.toLowerCase())) continue;
      seen.add(button);
      buttons.push(button);
      if (buttons.length > maxGalleryItems) break;
    }
    return buttons;
  }
  function findMainImage(documentContext) {
    const images = spec.imageSelector === 'img' ? documentContext?.images ?? queryAll(documentContext, spec.imageSelector) : queryAll(documentContext, spec.imageSelector);
    let selected = null;
    for (const image of images) {
      if (visible(image) && galleryMedia(image, spec, new URL(profile.url))
        && (selected === null || area(image) > area(selected))) selected = image;
    }
    return selected;
  }
  return { resolve, collect, readCurrent, referrer };
}
function queryAll(root, selector) { return [...(root?.querySelectorAll?.(selector) ?? [])]; }
function area(element) { const rect = element?.getBoundingClientRect?.(); return Number(rect?.width ?? 0) * Number(rect?.height ?? 0); }
function visible(element) { const rect = element?.getBoundingClientRect?.(); return Number(rect?.width ?? 0) > 0 && Number(rect?.height ?? 0) > 0; }
function activate(element) {
  if (typeof element?.click === 'function') { element.click(); return; }
  const click = element?.ownerDocument?.defaultView?.HTMLElement?.prototype?.click ?? globalThis.HTMLElement?.prototype?.click;
  if (typeof click !== 'function') throw batchError('BATCH_INCOMPLETE');
  click.call(element);
}

function naturalResolution(image) { const width = Number(image?.naturalWidth ?? 0); const height = Number(image?.naturalHeight ?? 0); return width > 0 && height > 0 ? `${width}x${height}` : null; }
