import { galleryMedia } from './media.js';
import { samePage } from './page-scope.js';
import { assertNotCancelled, createCollection, createGalleryInventory, galleryError, waitForGalleryCondition } from './collection.js';

const noOp = () => {};
const navigationTimeoutMs = 2500;
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
  async function collect({ context, locationContext = globalThis.location, waitFor = waitForGalleryCondition,
    documentContext = context?.carousel?.ownerDocument ?? globalThis.document,
    timeoutMs = navigationTimeoutMs, assertActive = noOp, signal, onItem, onProgress } = {}) {
    const carousel = context?.carousel;
    const assertCurrent = () => {
      assertActive();
      if (!carousel?.isConnected || itemId(locationContext?.href) !== context.postId
        || carousel.getAttribute(spec.rootIdentityAttribute) !== `${spec.rootIdentityPrefix}${context.postId}`) throw galleryError('BATCH_POST_CHANGED');
    };
    assertCurrent();
    assertNotCancelled(signal);
    const inventory = createGalleryInventory(() => slotInventory(carousel), {
      roots: [carousel], documentContext, attributes: [spec.slotAttribute],
      relevant: record => record.type === 'attributes' || [...record.addedNodes, ...record.removedNodes].some(node =>
        node.matches?.(spec.slotSelector) || node.querySelector?.(spec.slotSelector)),
    });
    const currentSize = () => Math.max(position(carousel)?.total ?? 0, inventory.current().size);
    const count = currentSize();
    if (!Number.isSafeInteger(count) || count < 2) {
      inventory.disconnect();
      throw galleryError('BATCH_INCOMPLETE');
    }
    const originalPage = position(carousel)?.page ?? null;
    const collection = createCollection({ onItem, onProgress, assertCurrent: () => {
      assertCurrent();
      if (currentSize() !== count) throw galleryError('BATCH_INCOMPLETE');
    }, signal });
    const options = { assertCurrent: collection.assertUsable, signal, waitFor, documentContext,
      timeoutMs: Number.isFinite(timeoutMs) ? Math.max(0, timeoutMs) : navigationTimeoutMs };
    let navigated = false;
    let failure;
    try {
      await collection.progress('collecting', count);
      for (let page = 1; page <= count; page += 1) {
        collection.assertUsable();
        let item = readPage(carousel, page, locationContext, inventory.current().slots);
        if (item === null) {
          if (originalPage === null) throw galleryError('BATCH_INCOMPLETE');
          navigated = true;
          await moveToPage(carousel, page, options);
          const loaded = await waitFor(() => {
            collection.assertUsable();
            item = readPage(carousel, page, locationContext, inventory.current().slots);
            return item !== null;
          }, options.timeoutMs, waitOptions(carousel, options));
          collection.assertUsable();
          if (!loaded) throw galleryError('BATCH_INCOMPLETE');
        }
        await collection.emit(item);
      }
      collection.assertUsable();
      await collection.progress('collecting', collection.collected);
    } catch (error) { failure = error; }
    if (navigated) {
      try {
        assertCurrent();
        // Cancellation may restore the original selection only while the same
        // page/provider is active. Restoration has a fresh budget per step.
        await onProgress?.({ phase: 'restoring', collected: collection.collected, total: failure ? count : collection.collected });
        assertCurrent();
        await moveToPage(carousel, originalPage, { ...options, signal: undefined, assertCurrent });
      } catch (error) { failure ??= error; }
    }
    inventory.disconnect();
    if (failure) throw failure;
    collection.assertUsable();
    return collection.result();
  }
  function readPage(carousel, page, locationContext, slots) {
    const slot = slots.get(page);
    if (!slot) return null;
    if (slot.querySelector(spec.unsupportedSelector)) throw galleryError('BATCH_UNSUPPORTED_MEDIA');
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
    return Math.max(position(carousel)?.total ?? 0, slotInventory(carousel).size);
  }
  function slotInventory(carousel) {
    let size = 0;
    const slots = new Map();
    for (const slot of carousel.querySelectorAll(spec.slotSelector)) {
      const value = slot.getAttribute(spec.slotAttribute);
      const suffix = value?.startsWith(spec.slotPrefix) ? value.slice(spec.slotPrefix.length) : '';
      if (/^\d+$/.test(suffix)) {
        const index = Number(suffix);
        size = Math.max(size, index);
        slots.set(index, slot);
      }
    }
    return { size, slots };
  }
  function position(carousel) {
    const label = carousel.shadowRoot?.querySelector(spec.positionSelector)?.getAttribute(spec.positionAttribute);
    const numbers = label?.match(/\d+/g);
    if (numbers?.length !== 2) return null;
    const [page, total] = numbers.map(Number);
    return Number.isSafeInteger(page) && Number.isSafeInteger(total) && page >= 1 && total >= page ? { page, total } : null;
  }
  async function moveToPage(carousel, target, options) {
    options.assertCurrent();
    const start = position(carousel)?.page;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(target)) throw galleryError('BATCH_INCOMPLETE');
    const steps = Math.abs(start - target);
    for (let attempt = 0; attempt < steps; attempt += 1) {
      options.assertCurrent();
      const before = position(carousel)?.page ?? null;
      if (before === target) return;
      if (before === null) throw galleryError('BATCH_INCOMPLETE');
      const direction = before < target ? spec.nextLabel : spec.previousLabel;
      const button = findAttribute(carousel.shadowRoot, spec.navigationSelector, 'aria-label', direction);
      if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') throw galleryError('BATCH_INCOMPLETE');
      options.assertCurrent();
      button.click();
      const changed = await options.waitFor(() => {
        options.assertCurrent();
        return position(carousel)?.page !== before;
      }, options.timeoutMs, waitOptions(carousel, options));
      options.assertCurrent();
      const after = position(carousel)?.page;
      if (!changed || after !== before + (direction === spec.nextLabel ? 1 : -1)) throw galleryError('BATCH_INCOMPLETE');
    }
    if (position(carousel)?.page !== target) throw galleryError('BATCH_INCOMPLETE');
  }
  return { resolve, collect };
}
function findAttribute(root, selector, attribute, value) {
  return [...(root?.querySelectorAll?.(selector) ?? [])].find(element => element.getAttribute(attribute) === value) ?? null;
}
function waitOptions(carousel, options) {
  return { roots: [carousel, carousel.shadowRoot], documentContext: options.documentContext, signal: options.signal };
}
