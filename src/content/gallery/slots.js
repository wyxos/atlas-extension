import { getAssetTarget } from '../assets.js';
import { samePage } from './page-scope.js';
export function createSlotGallery(profile) {
const spec = profile.gallery;
const providerName = profile.provider;


const maxGalleryItems = 50;

function resolveSlotBatchContext({ element, locationContext = globalThis.location } = {}) {
  const postId = galleryItemId(locationContext?.href);
  const carousel = element?.closest?.(spec.rootSelector);
  if (!postId || !carousel || carousel.getAttribute(spec.rootIdentityAttribute) !== `${spec.rootIdentityPrefix}${postId}`) return null;
  if (!element.closest(spec.assetAncestor) || gallerySize(carousel) < 2) return null;
  return { available: true, provider: providerName, postId, carousel };
}

async function collectSlotBatchItems({
  context,
  locationContext = globalThis.location,
  waitFor = waitUntil,
  timeoutMs = 15000,
} = {}) {
  const carousel = context?.carousel;
  const assertCurrentPost = () => {
    if (!carousel?.isConnected || galleryItemId(locationContext?.href) !== context.postId
      || carousel.getAttribute(spec.rootIdentityAttribute) !== `${spec.rootIdentityPrefix}${context.postId}`) {
      throw batchError('BATCH_POST_CHANGED');
    }
  };
  assertCurrentPost();
  const count = gallerySize(carousel);
  if (count < 2) throw batchError('BATCH_INCOMPLETE');
  if (count > maxGalleryItems) throw batchError('BATCH_TOO_LARGE');

  const originalPage = currentPage(carousel);
  const deadline = Date.now() + timeoutMs;
  const items = [];
  let navigated = false;
  try {
    for (let page = 1; page <= count; page += 1) {
      assertCurrentPost();
      let item = readPage(carousel, page, locationContext);
      if (item === null) {
        // Larger galleries only load nearby slides. Use the post's own controls
        // when a source is absent; fully populated galleries require no clicks.
        if (originalPage === null) throw batchError('BATCH_INCOMPLETE');
        navigated = true;
        await moveToPage(carousel, page, { assertCurrentPost, deadline, waitFor });
        await waitFor(() => {
          assertCurrentPost();
          item = readPage(carousel, page, locationContext);
          return item !== null;
        }, Math.max(0, Math.min(2500, deadline - Date.now())));
      }
      if (item === null) throw batchError('BATCH_INCOMPLETE');
      items.push(item);
    }
    assertCurrentPost();
    if (gallerySize(carousel) !== count) throw batchError('BATCH_INCOMPLETE');
  } finally {
    if (navigated && carousel.isConnected && galleryItemId(locationContext?.href) === context.postId) {
      await moveToPage(carousel, originalPage, {
        assertCurrentPost, deadline: Date.now() + 2500, waitFor,
      });
    }
  }

  // Check every slot before deduplicating so repeated artwork never disguises
  // an unresolved slot. Decorative background images are excluded in readPage.
  const seen = new Set();
  return items.filter((item) => {
    const url = new URL(item.asset.source);
    const key = `${url.origin}${url.pathname}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function readPage(carousel, page, locationContext) {
  const slot = carousel.querySelector(`${spec.slotSelector}[${spec.slotAttribute}="${spec.slotPrefix}${page}"]`);
  if (!slot) return null;
  if (slot.querySelector(spec.unsupportedSelector)) throw batchError('BATCH_UNSUPPORTED_MEDIA');
  const image = slot.querySelector(spec.imageSelector);
  if (!image) return null;
  // Source selection intentionally ignores visibility: off-screen slides are
  // valid batch items and use the same quality preference as the visible badge.
  const target = getAssetTarget(image, { siteDomain: locationContext.hostname, imageSourcePreference: spec.sourceMode });
  if (!target || !isSlotMediaUrl(target.source)) return null;
  const referrer = new URL(locationContext.href);
  if (spec.clearQuery) referrer.search = '';
  referrer.hash = '';
  referrer.searchParams.set(spec.indexParameter, String(page));
  return {
    asset: { ...target, type: 'image' },
    referrerUrl: referrer.href,
    source: locationContext.hostname,
  };
}

function gallerySize(carousel) {
  const pages = [...carousel.querySelectorAll(spec.slotSelector)]
    .map((slot) => slotNumber(slot.getAttribute(spec.slotAttribute)));
  const position = carouselPosition(carousel);
  return Math.max(0, position?.total ?? 0, ...pages);
}

function carouselPosition(carousel) {
  const label = carousel.shadowRoot?.querySelector(spec.positionSelector)
    ?.getAttribute(spec.positionAttribute);
  const numbers = label?.match(/\d+/g);
  if (numbers?.length !== 2) return null;
  const [page, total] = numbers.map(Number);
  return page >= 1 && total >= page ? { page, total } : null;
}

function currentPage(carousel) {
  return carouselPosition(carousel)?.page ?? null;
}

async function moveToPage(carousel, target, { assertCurrentPost, deadline, waitFor }) {
  for (let attempt = 0; attempt < maxGalleryItems; attempt += 1) {
    assertCurrentPost();
    const before = currentPage(carousel);
    if (before === target) return;
    if (before === null || Date.now() >= deadline) break;
    const direction = before < target ? spec.nextLabel : spec.previousLabel;
    const button = carousel.shadowRoot?.querySelector(`${spec.navigationSelector}[aria-label="${direction}"]`);
    if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') break;
    button.click();
    if (!await waitFor(() => {
      assertCurrentPost();
      return currentPage(carousel) !== before;
    }, Math.max(0, Math.min(2500, deadline - Date.now())))) break;
  }
  throw batchError('BATCH_INCOMPLETE');
}

async function waitUntil(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  do {
    if (predicate()) return true;
    await new Promise((resolve) => globalThis.setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  return false;
}

function galleryItemId(value) { return samePage(value, profile.url) ? profile.galleryKey : null; }
function slotNumber(value) { const suffix = value?.startsWith(spec.slotPrefix) ? value.slice(spec.slotPrefix.length) : ""; return /^\d+$/.test(suffix) ? Number(suffix) : 0; }

function isSlotMediaUrl(value) {
  const url = new URL(value);
  return url.protocol === 'https:' && (spec.mediaHosts ?? []).includes(url.hostname);
}

function batchError(code) {
  return Object.assign(new Error(code), { code, retryable: true });
}

return { resolve: resolveSlotBatchContext, collect: collectSlotBatchItems };
}
