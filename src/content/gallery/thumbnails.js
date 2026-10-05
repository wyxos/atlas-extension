import { galleryMedia } from './media.js';
import { getAssetType } from '../assets.js';
import { samePage } from './page-scope.js';
import { assertNotCancelled, createCollection, createGalleryInventory, galleryError, mediaIdentity, waitForGalleryCondition } from './collection.js';

const navigationTimeoutMs = 30000;
const restoreTimeoutMs = 2500;
const noOp = () => {};

// Desktop describes a page; the extension owns shared browser mechanics.
export function createThumbnailGallery(profile) {
  const spec = profile.gallery;
  function assertPage(location, assertActive = noOp, scope) {
    assertActive();
    if (!samePage(location?.href, profile.url) || scope?.root?.isConnected === false
      || scope?.container?.isConnected === false) throw galleryError('BATCH_POST_CHANGED');
  }
  function resolve({ element, documentContext = globalThis.document, locationContext = globalThis.location } = {}) {
    if (!samePage(locationContext?.href, profile.url)) return null;
    const scope = bindScope(documentContext, element);
    if (!scope) return null;
    if (findThumbnailButtons(scope).length < 2
      && !findNavigationButton(scope.root, spec.previousLabel)
      && !findNavigationButton(scope.root, spec.nextLabel)) return null;
    return { available: true, provider: profile.provider, ...scope };
  }
  async function collect({
    context, element, documentContext = globalThis.document, locationContext = globalThis.location,
    waitForChange = waitForChangeDefault, assertActive = noOp, timeoutMs = navigationTimeoutMs,
    signal, onItem, onProgress,
  } = {}) {
    assertPage(locationContext, assertActive);
    assertNotCancelled(signal);
    const boundScope = context?.root ? context : bindScope(documentContext, element);
    if (!boundScope) throw galleryError('BATCH_INCOMPLETE');
    const scope = { ...boundScope };
    const assertCurrent = () => assertPage(locationContext, assertActive, scope);
    const collection = createCollection({ onItem, onProgress, assertCurrent, signal });
    const originalSource = readCurrent({ documentContext, locationContext, scope, assertActive })?.asset.source;
    if (!originalSource) throw galleryError('BATCH_INCOMPLETE');
    const buttons = findThumbnailButtons(scope);
    const originalIndex = selectedIndex(buttons) ?? fileIndex(locationContext?.href);
    const options = { documentContext, locationContext, scope, waitForChange, assertCurrent, signal,
      timeoutMs: Number.isFinite(timeoutMs) ? Math.max(0, timeoutMs) : navigationTimeoutMs,
      currentIndex: originalIndex, navigated: false };
    let visualState = new WeakMap();
    const inventory = buttons.length > 1 ? createGalleryInventory(() => {
      visualState = new WeakMap();
      return findThumbnailButtons(scope, visualState);
    }, { roots: [scope.container], documentContext, attributes: ['src', 'srcset', 'class', 'style', 'hidden'],
      relevant: record => record.type !== 'attributes' || ['src', 'srcset', 'hidden'].includes(record.attributeName)
        || visualState.get(record.target) !== visible(record.target) }) : null;
    let restoreTarget = originalIndex;
    let failure;
    // Cache candidate nodes, not the selected image: a video can replace a
    // still-connected poster. Source/visibility changes are read on each capture;
    // Node changes (and attributes for custom selectors) outside the thumbnail
    // strip rebuild the candidate list.
    scope.mediaInventory = createGalleryInventory(() => mediaCandidates(scope.root, scope.container), {
      roots: [scope.root], documentContext, attributes: spec.imageSelector === 'img' ? [] : undefined,
      relevant: record => (record.type === 'childList' || spec.imageSelector !== 'img')
        && !contains(scope.container, record.target),
    });
    try {
      await collection.progress('collecting', buttons.length > 1 ? buttons.length : null);
      if (buttons.length > 1) {
        const keys = buttons.map(entry => entry.key);
        let validatedInventory = buttons;
        for (let index = 0; index < buttons.length; index += 1) {
          await selectThumbnail(index + 1, options, buttons);
          const current = inventory.current();
          // The observer keeps the same array until relevant mutations occur.
          // Validate a refreshed inventory once, not every key on every item.
          if (current !== validatedInventory) {
            if (current.length !== keys.length || current.some((entry, position) => entry.key !== keys[position])) throw galleryError('BATCH_INCOMPLETE');
            validatedInventory = current;
          }
          const item = readCurrent({ ...options, fileIndex: index + 1 });
          if (item?.asset.source === originalSource) restoreTarget = index + 1;
          await collection.emit(item);
        }
      } else {
        // Rewind without emitting so a start in the middle produces stable
        // first-to-last item identities for segmented submission and retry.
        const rewindSeen = new Set([mediaIdentity(snapshot(options))]);
        let rewindSteps = 0;
        while (await navigate(spec.previousLabel, options)) {
          rewindSteps += 1;
          const source = mediaIdentity(snapshot(options));
          if (rewindSeen.has(source)) throw galleryError('BATCH_INCOMPLETE');
          rewindSeen.add(source);
        }
        restoreTarget = rewindSteps + 1;
        options.currentIndex = 1;
        const seen = new Set();
        do {
          collection.assertUsable();
          const rawSource = snapshot(options);
          const source = rawSource ? mediaIdentity(rawSource) : null;
          if (!source || seen.has(source)) throw galleryError('BATCH_INCOMPLETE');
          seen.add(source);
          await collection.emit(readCurrent({ ...options, fileIndex: options.currentIndex }));
        } while (await navigate(spec.nextLabel, options));
      }
      await collection.progress('collecting', collection.collected);
    } catch (error) { failure = error; }
    // An AbortSignal cancels collection but not safe cleanup on the same page.
    // Provider/page invalidation prevents every restoration click and callback.
    if (options.navigated) {
      try {
        assertCurrent();
        await onProgress?.({ phase: 'restoring', collected: collection.collected,
          total: failure ? (buttons.length > 1 ? buttons.length : null) : collection.collected });
        assertCurrent();
        const restoration = { ...options, signal: undefined, timeoutMs: restoreTimeoutMs };
        if (buttons.length > 1) await selectThumbnail(restoreTarget, restoration, buttons);
        else await restoreIndex(restoreTarget, restoration);
        assertCurrent();
        if (snapshot(restoration) !== originalSource) throw galleryError('BATCH_INCOMPLETE');
      } catch (error) { failure ??= error; }
    }
    inventory?.disconnect();
    scope.mediaInventory.disconnect();
    if (failure) throw failure;
    collection.assertUsable();
    return collection.result();
  }
  function readCurrent({ documentContext = globalThis.document, locationContext = globalThis.location,
    scope, fileIndex: index = fileIndex(locationContext?.href), assertActive = noOp } = {}) {
    assertPage(locationContext, assertActive, scope);
    const element = findMainMedia(scope?.root ?? documentContext, scope?.container,
      scope?.mediaInventory?.current(), scope?.mainImage);
    if (scope) {
      scope.main = element;
      if (element && getAssetType(element) !== 'video') scope.mainImage = element;
    }
    const media = galleryMedia(element, spec, new URL(locationContext.href));
    if (!media) return null;
    return {
      asset: { ...media, resolution: element?.complete === false ? null : media.resolution ?? naturalResolution(element),
        type: getAssetType(element) ?? 'image', ...(profile.identity ? { providerIdentity: profile.identity } : {}) },
      referrerUrl: referrer(locationContext.href, index), source: new URL(locationContext.href).hostname,
    };
  }
  function referrer(rawUrl, index) {
    const url = new URL(rawUrl);
    if (spec.clearQuery) { url.search = ''; url.hash = ''; }
    url.searchParams.set(spec.indexParameter, String(Math.max(1, Number(index) || 1)));
    return url.href;
  }
  function assertUsable(options) { options.assertCurrent(); assertNotCancelled(options.signal); }
  async function selectThumbnail(target, options, buttons) {
    assertUsable(options);
    if (options.currentIndex === target) return;
    const before = snapshot(options);
    const entry = buttons[target - 1];
    if (!entry || entry.button.isConnected === false) throw galleryError('BATCH_INCOMPLETE');
    assertUsable(options);
    options.navigated = true;
    activate(entry.button);
    options.currentIndex = target;
    await waitForChanged(before, options);
  }
  async function navigate(direction, options) {
    assertUsable(options);
    const button = findNavigationButton(options.scope.root, direction);
    if (!button) return false;
    const before = snapshot(options);
    assertUsable(options);
    options.navigated = true;
    activate(button);
    options.currentIndex = Math.max(1, options.currentIndex + (direction === spec.nextLabel ? 1 : -1));
    await waitForChanged(before, options);
    return true;
  }
  async function restoreIndex(target, options) {
    const steps = Math.abs(options.currentIndex - target);
    const seen = new Set([mediaIdentity(snapshot(options))]);
    for (let step = 0; step < steps; step += 1) {
      if (!await navigate(options.currentIndex > target ? spec.previousLabel : spec.nextLabel, options)) throw galleryError('BATCH_INCOMPLETE');
      const source = mediaIdentity(snapshot(options));
      if (seen.has(source)) throw galleryError('BATCH_INCOMPLETE');
      seen.add(source);
    }
    if (options.currentIndex !== target) throw galleryError('BATCH_INCOMPLETE');
  }
  async function waitForChanged(before, options) {
    assertUsable(options);
    const changed = await options.waitForChange({ before, documentContext: options.documentContext,
      locationContext: options.locationContext, scope: options.scope,
      assertActive: () => assertUsable(options), timeoutMs: options.timeoutMs, signal: options.signal });
    assertUsable(options);
    if (!changed || !snapshot(options) || snapshot(options) === before) throw galleryError('BATCH_INCOMPLETE');
  }
  function waitForChangeDefault({ before, documentContext, locationContext, scope, assertActive,
    timeoutMs = navigationTimeoutMs, signal }) {
    return waitForGalleryCondition(() => {
      assertActive();
      const source = snapshot({ documentContext, locationContext, scope, assertActive });
      return Boolean(source && source !== before);
    }, timeoutMs, { roots: [scope.root], documentContext, signal });
  }
  function snapshot(options) { return readCurrent(options)?.asset?.source ?? ''; }
  function fileIndex(rawUrl) {
    try { const index = Number(new URL(rawUrl).searchParams.get(spec.indexParameter)); return Number.isSafeInteger(index) && index > 0 ? index : 1; }
    catch { return 1; }
  }
  function findNavigationButton(root, label) {
    return queryAll(root, spec.navigationSelector).find(element =>
      element?.disabled !== true && element?.getAttribute?.('aria-disabled') !== 'true'
      && element?.getAttribute?.('aria-label') === label && visible(element)) ?? null;
  }
  function thumbnailGroups(documentContext, visualState) {
    const groups = new Map();
    for (const image of queryAll(documentContext, spec.thumbnailSelector)) {
      const button = image?.closest?.(spec.thumbnailButtonSelector);
      const container = image?.closest?.(spec.thumbnailContainerSelector);
      if (visualState) for (let node = image; node; node = node.parentElement) {
        visualState.set(node, visible(node));
        if (node === container) break;
      }
      if (visualState && button) visualState.set(button, visible(button));
      const media = galleryMedia(image, spec, new URL(profile.url));
      if (!button || !container || !visible(button) || !visible(image) || !media
        || !String(container.textContent ?? '').toLowerCase().includes(String(spec.thumbnailContainerText ?? '').toLowerCase())) continue;
      const entries = groups.get(container) ?? [];
      entries.push({ button, key: mediaIdentity(media.source) });
      groups.set(container, entries);
    }
    return groups;
  }
  function findThumbnailButtons(scope, visualState) {
    if (!scope.container) return [];
    const entries = thumbnailGroups(scope.root, visualState).get(scope.container) ?? [];
    const seenButtons = new Set();
    const seenItems = new Set();
    return entries.filter(entry => {
      if (seenButtons.has(entry.button) || seenItems.has(entry.key)) return false;
      seenButtons.add(entry.button); seenItems.add(entry.key); return true;
    });
  }
  function bindScope(documentContext, element) {
    const groups = thumbnailGroups(documentContext);
    const main = element ?? findMainMedia(documentContext);
    if (element && (!visible(element) || !galleryMedia(element, spec, new URL(profile.url)))) return null;
    const explicitRoot = spec.rootSelector ? main?.closest?.(spec.rootSelector) : null;
    if (spec.rootSelector && !explicitRoot) return null;
    if (explicitRoot) {
      const containers = [...groups.keys()].filter(container => contains(explicitRoot, container));
      if (containers.length > 1) return null;
      if (element && findMainMedia(explicitRoot, containers[0]) !== element) return null;
      return { root: explicitRoot, container: containers[0] ?? null, main };
    }
    for (let root = main?.parentElement; root && root !== documentContext.documentElement; root = root.parentElement) {
      const containers = [...groups.keys()].filter(container => contains(root, container));
      if (containers.length > 1) return null;
      if (containers.length === 1 || (groups.size === 0
        && (findNavigationButton(root, spec.previousLabel) || findNavigationButton(root, spec.nextLabel)))) {
        if (element && findMainMedia(root, containers[0]) !== element) return null;
        return { root, container: containers[0] ?? null, main };
      }
    }
    // Legacy profiles need no root selector, but multiple matching containers
    // are ambiguous. Never combine them into a document-wide gallery.
    if (groups.size > 1) return null;
    if (element && findMainMedia(documentContext, [...groups.keys()][0]) !== element) return null;
    return { root: documentContext, container: [...groups.keys()][0] ?? null, main };
  }
  function mediaCandidates(root, container) {
    const images = spec.imageSelector === 'img' ? root?.images ?? queryAll(root, spec.imageSelector) : queryAll(root, spec.imageSelector);
    // Existing thumbnail descriptors describe image selection. Video is a
    // shared media primitive within that same gallery, not a provider override.
    const outsideStrip = element => !container || !contains(container, element);
    return { images: [...images].filter(outsideStrip), videos: queryAll(root, 'video').filter(outsideStrip) };
  }
  function findMainMedia(root, container, candidates = mediaCandidates(root, container), boundImage) {
    // Navigation-only profiles can have large unrelated image inventories.
    // Preserve their bound-image fast path while still checking for a video
    // that has appeared over it. Never pin a video across subsequent slides.
    let selected = boundImage?.isConnected === true && !boundImage.hidden && visible(boundImage)
      && contains(root, boundImage) && (!container || !contains(container, boundImage))
      && (spec.imageSelector === 'img' || boundImage.matches?.(spec.imageSelector) !== false)
      && galleryMedia(boundImage, spec, new URL(profile.url)) ? boundImage : null;
    for (const element of selected ? candidates.videos : [...candidates.images, ...candidates.videos]) {
      const video = getAssetType(element) === 'video';
      const replacesImage = video && selected && getAssetType(selected) !== 'video';
      // A pending video must win over its poster too; otherwise the poster is
      // mistaken for the next gallery item before loadedmetadata supplies a URL.
      if (element.isConnected !== false && !element.hidden && visible(element)
        && (video || galleryMedia(element, spec, new URL(profile.url)))
        && (selected === null || (replacesImage ? sharesMediaRegion(element, selected)
          : area(element) > area(selected)))) selected = element;
    }
    return selected;
  }
  return { resolve, collect, readCurrent, referrer };
}
function queryAll(root, selector) { return selector ? [...(root?.querySelectorAll?.(selector) ?? [])] : []; }
function contains(root, element) {
  if (root === element || root?.contains?.(element)) return true;
  for (let parent = element?.parentElement; parent; parent = parent.parentElement) if (parent === root) return true;
  return false;
}
function selectedIndex(buttons) {
  const index = buttons.findIndex(({ button }) => ['aria-selected', 'aria-pressed'].some(attribute => button.getAttribute?.(attribute) === 'true')
    || ['true', 'page'].includes(button.getAttribute?.('aria-current')));
  return index >= 0 ? index + 1 : null;
}
function area(element) { const rect = element?.getBoundingClientRect?.(); return Number(rect?.width ?? 0) * Number(rect?.height ?? 0); }
function visible(element) { return area(element) > 0; }
function sharesMediaRegion(video, image) {
  if (getAssetType(image) === 'video') return false;
  const a = video.getBoundingClientRect(); const b = image.getBoundingClientRect();
  if (![a.left, a.top, b.left, b.top].every(Number.isFinite)) return false;
  const centerInside = (inner, outer) => inner.left + inner.width / 2 >= outer.left
    && inner.left + inner.width / 2 <= outer.left + outer.width
    && inner.top + inner.height / 2 >= outer.top
    && inner.top + inner.height / 2 <= outer.top + outer.height;
  // A letterboxed player can be smaller than its retained poster. Prefer it
  // within the same stage without adopting an unrelated player beside it.
  return centerInside(a, b) && centerInside(b, a);
}
function activate(element) {
  if (typeof element?.click === 'function') { element.click(); return; }
  const click = element?.ownerDocument?.defaultView?.HTMLElement?.prototype?.click ?? globalThis.HTMLElement?.prototype?.click;
  if (typeof click !== 'function') throw galleryError('BATCH_INCOMPLETE');
  click.call(element);
}
function naturalResolution(image) { const width = Number(image?.naturalWidth ?? 0); const height = Number(image?.naturalHeight ?? 0); return width > 0 && height > 0 ? `${width}x${height}` : null; }
