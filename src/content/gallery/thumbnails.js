import { samePage } from './page-scope.js';

// The complete bounded collection algorithm ships with the extension.
// Desktop supplies selectors and labels, never commands or executable code.
export function createThumbnailGallery(profile) {
const spec = profile.gallery;
const providerName = profile.provider;
const captureProviderIdentity = () => profile.identity;
const assertPage = location => { if (!samePage(location?.href, profile.url)) throw new Error('The gallery page changed. Retry the batch.'); };
const defaultMaxItems = 50;
// Allow slow gallery rendering, but never wait for the image bytes to download.
const defaultNavigationTimeoutMs = 30000;
const defaultPollMs = 50;

function resolveThumbnailBatchContext({
  documentContext = globalThis.document,
  locationContext = globalThis.location,
} = {}) {
  if (!isThumbnailDeviationUrl(locationContext?.href)) {
    return null;
  }

  if (
    findThumbnailButtons(documentContext).length < 2
    && !findNavigationButton(documentContext, spec.previousLabel)
    && !findNavigationButton(documentContext, spec.nextLabel)
  ) {
    return null;
  }

  return {
    available: true,
    provider: providerName,
  };
}

async function collectGalleryItems({
  documentContext = globalThis.document,
  locationContext = globalThis.location,
  maxItems = defaultMaxItems,
  waitForChange = waitForThumbnailChange,
} = {}) {
  maxItems = Math.max(1, Math.min(defaultMaxItems, maxItems));
  assertPage(locationContext);
  const thumbnailButtons = findThumbnailButtons(documentContext);

  if (thumbnailButtons.length > 1) {
    return collectThumbnailBatchItems(thumbnailButtons, {
      documentContext,
      locationContext,
      maxItems,
      waitForChange,
    });
  }

  const originalFileIndex = fileIndexFromUrl(locationContext?.href);
  const itemsByReferrer = new Map();
  const options = { documentContext, locationContext, maxItems, waitForChange, currentFileIndex: originalFileIndex };

  collectCurrentItem(itemsByReferrer, documentContext, locationContext, options.currentFileIndex);

  try {
    let attempts = 0;
    while (attempts < maxItems && await moveNavigation(spec.previousLabel, options)) {
      attempts += 1;
      collectCurrentItem(itemsByReferrer, documentContext, locationContext, options.currentFileIndex);
    }

    attempts = 0;
    while (attempts < maxItems && await moveNavigation(spec.nextLabel, options)) {
      attempts += 1;
      collectCurrentItem(itemsByReferrer, documentContext, locationContext, options.currentFileIndex);
    }
  } finally {
    if (samePage(options.locationContext?.href, profile.url)) await restoreFileIndex(originalFileIndex, options);
  }

  return [...itemsByReferrer.values()].sort((left, right) => (
    fileIndexFromUrl(left.referrerUrl) - fileIndexFromUrl(right.referrerUrl)
  ));
}

function readCurrentThumbnailBatchItem({
  documentContext = globalThis.document,
  locationContext = globalThis.location,
  fileIndex = fileIndexFromUrl(locationContext?.href),
} = {}) {
  assertPage(locationContext);
  const image = findMainImage(documentContext);
  const source = normalizeUrl(readImageSource(image));

  if (source === null) {
    return null;
  }

  return {
    asset: {
      ...(captureProviderIdentity({ documentContext, pageUrl: locationContext?.href }) ? {
        providerIdentity: captureProviderIdentity({ documentContext, pageUrl: locationContext?.href }),
      } : {}),
      resolution: readImageResolution(image),
      source,
      type: 'image',
    },
    referrerUrl: galleryReferrerForFileIndex(locationContext.href, fileIndex),
    source: new URL(locationContext.href).hostname,
  };
}

function galleryReferrerForFileIndex(rawUrl, fileIndex) {
  const url = new URL(rawUrl);

  url.searchParams.set(spec.indexParameter, String(Math.max(1, Number(fileIndex) || 1)));

  return url.href;
}

function collectCurrentItem(itemsByReferrer, documentContext, locationContext, fileIndex) {
  const item = readCurrentThumbnailBatchItem({ documentContext, locationContext, fileIndex });

  if (item !== null) {
    itemsByReferrer.set(item.referrerUrl, item);
  }
}

async function collectThumbnailBatchItems(thumbnailButtons, {
  documentContext,
  locationContext,
  maxItems,
  waitForChange,
}) {
  const originalFileIndex = fileIndexFromUrl(locationContext?.href);
  const itemsByReferrer = new Map();
  const buttons = thumbnailButtons.slice(0, maxItems);
  // The carousel can change media without updating location. Track the selected
  // thumbnail ourselves, including when restoring the original selection.
  const options = { documentContext, locationContext, maxItems, waitForChange, currentFileIndex: originalFileIndex };

  try {
    for (const [index, button] of buttons.entries()) {
      const targetFileIndex = index + 1;
      if (!await selectThumbnailFile(targetFileIndex, button, options)) {
        throw new Error('Atlas could not read every gallery image. Retry the batch.');
      }
      collectCurrentItem(itemsByReferrer, documentContext, locationContext, targetFileIndex);
    }
  } finally {
    if (samePage(options.locationContext?.href, profile.url)) await restoreThumbnailFileIndex(originalFileIndex, buttons, options);
  }

  return [...itemsByReferrer.values()].sort((left, right) => (
    fileIndexFromUrl(left.referrerUrl) - fileIndexFromUrl(right.referrerUrl)
  ));
}

async function selectThumbnailFile(targetFileIndex, button, options) {
  if (options.currentFileIndex === targetFileIndex) {
    return true;
  }

  assertPage(options.locationContext);
  const before = snapshotKey(options.documentContext, options.locationContext);

  activateElement(findThumbnailButtons(options.documentContext)[targetFileIndex - 1] ?? button);

  const changed = await options.waitForChange({
    before,
    documentContext: options.documentContext,
    locationContext: options.locationContext,
  });
  if (changed) options.currentFileIndex = targetFileIndex;
  return changed;
}

async function restoreThumbnailFileIndex(targetFileIndex, buttons, options) {
  const targetButton = buttons[targetFileIndex - 1];

  if (targetButton !== undefined) {
    await selectThumbnailFile(targetFileIndex, targetButton, options);

    return;
  }

  await restoreFileIndex(targetFileIndex, options);
}

async function restoreFileIndex(targetFileIndex, options) {
  let attempts = 0;

  while (attempts < options.maxItems && options.currentFileIndex > targetFileIndex) {
    attempts += 1;
    if (!await moveNavigation(spec.previousLabel, options)) {
      break;
    }
  }

  while (attempts < options.maxItems && options.currentFileIndex < targetFileIndex) {
    attempts += 1;
    if (!await moveNavigation(spec.nextLabel, options)) {
      break;
    }
  }
}

async function moveNavigation(direction, options) {
  const { documentContext, locationContext, waitForChange } = options;
  assertPage(locationContext);
  const button = findNavigationButton(documentContext, direction);

  if (button === null) {
    return false;
  }

  const before = snapshotKey(documentContext, locationContext);
  const beforeUrl = locationContext?.href;

  activateElement(button);

  const changed = await waitForChange({
    before,
    documentContext,
    locationContext,
  });
  if (!changed) {
    throw new Error('Atlas could not read every image in this deviation. Retry the batch.');
  }
  options.currentFileIndex = locationContext?.href !== beforeUrl
    ? fileIndexFromUrl(locationContext?.href)
    : Math.max(1, options.currentFileIndex + (direction === spec.nextLabel ? 1 : -1));
  return true;
}

async function waitForThumbnailChange({
  before,
  documentContext,
  locationContext,
  pollMs = defaultPollMs,
  timeoutMs = defaultNavigationTimeoutMs,
}) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    await new Promise((resolve) => {
      globalThis.setTimeout(resolve, pollMs);
    });

    const source = snapshotKey(documentContext, locationContext);
    if (source !== '' && source !== before) {
      return true;
    }
  }

  return false;
}

function findNavigationButton(documentContext, label) {
  return queryAll(documentContext, spec.navigationSelector)
    .find((element) => (
      element?.disabled !== true
      && element?.getAttribute?.('aria-disabled') !== 'true'
      && element?.getAttribute?.('aria-label') === label
      && isVisibleElement(element)
    )) ?? null;
}

function findThumbnailButtons(documentContext) {
  const seen = new Set();
  const buttons = [];

  for (const image of queryAll(documentContext, spec.thumbnailSelector)) {
    const button = image?.closest?.(spec.thumbnailButtonSelector) ?? null;

    if (
      button === null
      || seen.has(button)
      || !isVisibleElement(button)
      || !isVisibleElement(image)
      || normalizeUrl(readImageSource(image)) === null
      || !isAllImagesThumbnail(image)
    ) {
      continue;
    }

    seen.add(button);
    buttons.push(button);
  }

  return buttons;
}

function isAllImagesThumbnail(image) {
  const section = image?.closest?.(spec.thumbnailContainerSelector) ?? null;
  const text = typeof section?.textContent === 'string' ? section.textContent.toLowerCase() : '';

  return text.includes(spec.thumbnailContainerText.toLowerCase());
}

function findMainImage(documentContext) {
  return [...(documentContext?.images ?? queryAll(documentContext, spec.imageSelector))]
    .filter((image) => normalizeUrl(readImageSource(image)) !== null && isVisibleElement(image))
    .sort((left, right) => elementArea(right) - elementArea(left))[0] ?? null;
}

function readImageSource(image) {
  return image?.getAttribute?.('src') ?? image?.src ?? image?.currentSrc ?? null;
}

function readImageResolution(image) {
  // Dimensions can still belong to the previous source while a reused image loads.
  if (image?.complete === false) return null;
  const width = Number(image?.naturalWidth ?? 0);
  const height = Number(image?.naturalHeight ?? 0);

  return width > 0 && height > 0 ? `${width}x${height}` : null;
}

function snapshotKey(documentContext, locationContext) {
  const item = readCurrentThumbnailBatchItem({ documentContext, locationContext });
  // A URL change alone does not mean the newly selected image has rendered.
  return item?.asset?.source ?? '';
}

function fileIndexFromUrl(rawUrl) {
  try {
    const index = Number(new URL(rawUrl).searchParams.get(spec.indexParameter));

    return Number.isInteger(index) && index > 0 ? index : 1;
  } catch {
    return 1;
  }
}

function isThumbnailDeviationUrl(rawUrl) {
  return samePage(rawUrl, profile.url);
}

function queryAll(documentContext, selector) {
  return [...(documentContext?.querySelectorAll?.(selector) ?? [])];
}

function isVisibleElement(element) {
  const rect = element?.getBoundingClientRect?.();

  return Number(rect?.width ?? 0) > 0 && Number(rect?.height ?? 0) > 0;
}

function elementArea(element) {
  const rect = element?.getBoundingClientRect?.();

  return Number(rect?.width ?? 0) * Number(rect?.height ?? 0);
}

function activateElement(element) {
  if (typeof element?.click === 'function') {
    element.click();

    return;
  }

  const nativeClick = element?.ownerDocument?.defaultView?.HTMLElement?.prototype?.click
    ?? globalThis.HTMLElement?.prototype?.click;

  if (typeof nativeClick === 'function') {
    nativeClick.call(element);
  }
}

function normalizeUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }

  try {
    const url = new URL(value);

    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

return { resolve: resolveThumbnailBatchContext, collect: collectGalleryItems, readCurrent: readCurrentThumbnailBatchItem, referrer: galleryReferrerForFileIndex };
}

