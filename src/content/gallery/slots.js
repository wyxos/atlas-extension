import { galleryMedia } from './media.js';
import { samePage } from './page-scope.js';

const maxGalleryItems = 50;
const noOp = () => {};
const batchError = code => Object.assign(new Error(code), { code, retryable: true });
export function createSlotGallery(profile) {
  const spec = profile.gallery;
  function itemId(value) { return samePage(value, profile.url) ? profile.galleryKey : null; }
  function resolve({ element, locationContext = globalThis.location } = {}) {
    const postId = itemId(locationContext?.href);
    const carousel = element?.closest?.(spec.rootSelector);
    if (!postId || !carousel || carousel.getAttribute(spec.rootIdentityAttribute) !== `${spec.rootIdentityPrefix}${postId}`) return null;
    if (!element.closest(spec.assetAncestor) || gallerySize(carousel) < 2) return null;
    return { available: true, provider: profile.provider, postId, carousel };
  }
  async function collect({ context, locationContext = globalThis.location, waitFor = waitUntil,
    timeoutMs = 15000, assertActive = noOp } = {}) {
    const carousel = context?.carousel;
    const assertCurrent = () => {
      assertActive();
      if (!carousel?.isConnected || itemId(locationContext?.href) !== context.postId
        || carousel.getAttribute(spec.rootIdentityAttribute) !== `${spec.rootIdentityPrefix}${context.postId}`) throw batchError('BATCH_POST_CHANGED');
    };
    assertCurrent();
    const count = gallerySize(carousel);
    if (count < 2) throw batchError('BATCH_INCOMPLETE');
    if (count > maxGalleryItems) throw batchError('BATCH_TOO_LARGE');
    const originalPage = position(carousel)?.page ?? null;
    const duration = Number.isFinite(timeoutMs) ? Math.max(0, Math.min(15000, timeoutMs)) : 15000;
    const options = { assertCurrent, deadline: Date.now() + duration, waitFor };
    const items = [];
    let navigated = false;
    let failure;
    try {
      for (let page = 1; page <= count; page += 1) {
        assertUsable(options);
        let item = readPage(carousel, page, locationContext);
        if (item === null) {
          if (originalPage === null) throw batchError('BATCH_INCOMPLETE');
          navigated = true;
          await moveToPage(carousel, page, options);
          assertUsable(options);
          await waitFor(() => {
            assertUsable(options);
            item = readPage(carousel, page, locationContext);
            return item !== null;
          }, remaining(options));
          assertUsable(options);
        }
        if (item === null) throw batchError('BATCH_INCOMPLETE');
        items.push(item);
      }
      assertUsable(options);
      if (gallerySize(carousel) !== count) throw batchError('BATCH_INCOMPLETE');
    } catch (error) { failure = error; }
    if (navigated) {
      try {
        assertCurrent();
        await moveToPage(carousel, originalPage, { ...options, deadline: Date.now() + 2500 });
      } catch (error) { failure ??= error; }
    }
    if (failure) throw failure;
    assertCurrent();
    const seen = new Set();
    return items.filter(item => {
      const url = new URL(item.asset.source);
      const key = `${url.origin}${url.pathname}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  function readPage(carousel, page, locationContext) {
    const slot = findAttribute(carousel, spec.slotSelector, spec.slotAttribute, `${spec.slotPrefix}${page}`);
    if (!slot) return null;
    if (slot.querySelector(spec.unsupportedSelector)) throw batchError('BATCH_UNSUPPORTED_MEDIA');
    const image = slot.querySelector(spec.imageSelector);
    if (!image) return null;
    const target = galleryMedia(image, spec, locationContext);
    if (!target) return null;
    const referrer = new URL(locationContext.href);
    if (spec.clearQuery) referrer.search = '';
    referrer.hash = '';
    referrer.searchParams.set(spec.indexParameter, String(page));
    return { asset: { ...target, type: 'image', ...(profile.identity ? { providerIdentity: profile.identity } : {}) },
      referrerUrl: referrer.href, source: new URL(locationContext.href).hostname };
  }
  function gallerySize(carousel) {
    let size = position(carousel)?.total ?? 0;
    for (const slot of carousel.querySelectorAll(spec.slotSelector)) {
      const value = slot.getAttribute(spec.slotAttribute);
      const suffix = value?.startsWith(spec.slotPrefix) ? value.slice(spec.slotPrefix.length) : '';
      if (/^\d+$/.test(suffix)) size = Math.max(size, Number(suffix));
      if (size > maxGalleryItems) return size;
    }
    return size;
  }
  function position(carousel) {
    const label = carousel.shadowRoot?.querySelector(spec.positionSelector)?.getAttribute(spec.positionAttribute);
    const numbers = label?.match(/\d+/g);
    if (numbers?.length !== 2) return null;
    const [page, total] = numbers.map(Number);
    return Number.isSafeInteger(page) && Number.isSafeInteger(total) && page >= 1 && total >= page ? { page, total } : null;
  }
  async function moveToPage(carousel, target, options) {
    for (let attempt = 0; attempt < maxGalleryItems; attempt += 1) {
      assertUsable(options);
      const before = position(carousel)?.page ?? null;
      if (before === target) return;
      if (before === null) break;
      const direction = before < target ? spec.nextLabel : spec.previousLabel;
      const button = findAttribute(carousel.shadowRoot, spec.navigationSelector, 'aria-label', direction);
      if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') break;
      assertUsable(options);
      button.click();
      const changed = await options.waitFor(() => {
        assertUsable(options);
        return position(carousel)?.page !== before;
      }, remaining(options));
      assertUsable(options);
      if (!changed) break;
    }
    throw batchError('BATCH_INCOMPLETE');
  }
  return { resolve, collect };
}
function findAttribute(root, selector, attribute, value) {
  return [...(root?.querySelectorAll?.(selector) ?? [])].find(element => element.getAttribute(attribute) === value) ?? null;
}
function assertUsable(options) {
  options.assertCurrent();
  if (Date.now() >= options.deadline) throw batchError('BATCH_INCOMPLETE');
}
function remaining(options) { return Math.max(0, Math.min(2500, options.deadline - Date.now())); }
async function waitUntil(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  do {
    if (predicate()) return true;
    await new Promise(resolve => globalThis.setTimeout(resolve, Math.min(50, Math.max(0, deadline - Date.now()))));
  } while (Date.now() < deadline);
  return false;
}
