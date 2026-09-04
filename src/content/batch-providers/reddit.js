import { getAssetTarget } from '../assets.js';

const maxGalleryItems = 50;

export function resolveRedditBatchContext({ element, locationContext = globalThis.location } = {}) {
  const postId = redditPostId(locationContext?.href);
  const carousel = element?.closest?.('gallery-carousel');
  if (!postId || !carousel || carousel.getAttribute('post-id') !== `t3_${postId}`) return null;
  if (!element.closest('figure') || gallerySize(carousel) < 2) return null;
  return { available: true, provider: 'reddit', postId, carousel };
}

export async function collectRedditBatchItems({
  context,
  locationContext = globalThis.location,
  waitFor = waitUntil,
  timeoutMs = 15000,
} = {}) {
  const carousel = context?.carousel;
  const assertCurrentPost = () => {
    if (!carousel?.isConnected || redditPostId(locationContext?.href) !== context.postId
      || carousel.getAttribute('post-id') !== `t3_${context.postId}`) {
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
    if (navigated && carousel.isConnected && redditPostId(locationContext?.href) === context.postId) {
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
  const slot = carousel.querySelector(`li[slot="page-${page}"]`);
  if (!slot) return null;
  if (slot.querySelector('video, audio, shreddit-player')) throw batchError('BATCH_UNSUPPORTED_MEDIA');
  const image = slot.querySelector('figure img');
  if (!image) return null;
  // Source selection intentionally ignores visibility: off-screen slides are
  // valid batch items and use the same quality preference as the visible badge.
  const target = getAssetTarget(image, { siteDomain: locationContext.hostname });
  if (!target || !isRedditMediaUrl(target.source)) return null;
  const referrer = new URL(locationContext.href);
  referrer.search = '';
  referrer.hash = '';
  referrer.searchParams.set('img_index', String(page));
  return {
    asset: { ...target, type: 'image' },
    referrerUrl: referrer.href,
    source: locationContext.hostname,
  };
}

function gallerySize(carousel) {
  const pages = [...carousel.querySelectorAll('li[slot]')]
    .map((slot) => Number(slot.getAttribute('slot')?.match(/^page-(\d+)$/)?.[1]) || 0);
  const position = carouselPosition(carousel);
  return Math.max(0, position?.total ?? 0, ...pages);
}

function carouselPosition(carousel) {
  const label = carousel.shadowRoot?.querySelector('faceplate-carousel')
    ?.getAttribute('current-aria-live-msg');
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
    const direction = before < target ? 'Next page' : 'Previous page';
    const button = carousel.shadowRoot?.querySelector(`button[aria-label="${direction}"]`);
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

function redditPostId(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)
      || !(url.hostname === 'reddit.com' || url.hostname.endsWith('.reddit.com'))) return null;
    return url.pathname.match(/^\/(?:r\/[^/]+\/)?comments\/([a-z0-9]+)(?:\/|$)/i)?.[1]
      ?? url.pathname.match(/^\/gallery\/([a-z0-9]+)(?:\/|$)/i)?.[1]
      ?? null;
  } catch {
    return null;
  }
}

function isRedditMediaUrl(value) {
  const url = new URL(value);
  return url.protocol === 'https:' && ['i.redd.it', 'preview.redd.it'].includes(url.hostname);
}

function batchError(code) {
  return Object.assign(new Error(code), { code, retryable: true });
}
