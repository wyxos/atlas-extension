const providerName = 'deviantart';
const defaultMaxItems = 50;
const defaultNavigationTimeoutMs = 2500;
const defaultPollMs = 50;

export function resolveDeviantArtBatchContext({
  documentContext = globalThis.document,
  locationContext = globalThis.location,
} = {}) {
  if (!isDeviantArtDeviationUrl(locationContext?.href)) {
    return null;
  }

  if (
    findThumbnailButtons(documentContext).length < 2
    && !findNavigationButton(documentContext, 'Previous')
    && !findNavigationButton(documentContext, 'Next')
  ) {
    return null;
  }

  return {
    available: true,
    provider: providerName,
  };
}

export async function collectDeviantArtBatchItems({
  documentContext = globalThis.document,
  locationContext = globalThis.location,
  maxItems = defaultMaxItems,
  waitForChange = waitForDeviantArtChange,
} = {}) {
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

  collectCurrentItem(itemsByReferrer, documentContext, locationContext);

  let attempts = 0;
  while (attempts < maxItems && await moveNavigation('Previous', {
    documentContext,
    locationContext,
    waitForChange,
  })) {
    attempts += 1;
    collectCurrentItem(itemsByReferrer, documentContext, locationContext);
  }

  attempts = 0;
  while (attempts < maxItems && await moveNavigation('Next', {
    documentContext,
    locationContext,
    waitForChange,
  })) {
    attempts += 1;
    collectCurrentItem(itemsByReferrer, documentContext, locationContext);
  }

  await restoreFileIndex(originalFileIndex, {
    documentContext,
    locationContext,
    maxItems,
    waitForChange,
  });

  return [...itemsByReferrer.values()].sort((left, right) => (
    fileIndexFromUrl(left.referrerUrl) - fileIndexFromUrl(right.referrerUrl)
  ));
}

export function readCurrentDeviantArtBatchItem({
  documentContext = globalThis.document,
  locationContext = globalThis.location,
} = {}) {
  const image = findMainImage(documentContext);
  const source = normalizeUrl(readImageSource(image));

  if (source === null) {
    return null;
  }

  return {
    asset: {
      resolution: readImageResolution(image),
      source,
      type: 'image',
    },
    referrerUrl: deviantArtReferrerForFileIndex(locationContext.href, fileIndexFromUrl(locationContext.href)),
    source: new URL(locationContext.href).hostname,
  };
}

export function deviantArtReferrerForFileIndex(rawUrl, fileIndex) {
  const url = new URL(rawUrl);

  url.searchParams.set('file', String(Math.max(1, Number(fileIndex) || 1)));

  return url.href;
}

function collectCurrentItem(itemsByReferrer, documentContext, locationContext) {
  const item = readCurrentDeviantArtBatchItem({ documentContext, locationContext });

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

  for (const [index, button] of buttons.entries()) {
    const targetFileIndex = index + 1;

    if (await selectThumbnailFile(targetFileIndex, button, { documentContext, locationContext, waitForChange })) {
      collectCurrentItem(itemsByReferrer, documentContext, locationContext);
    }
  }

  await restoreThumbnailFileIndex(originalFileIndex, buttons, {
    documentContext,
    locationContext,
    maxItems,
    waitForChange,
  });

  return [...itemsByReferrer.values()].sort((left, right) => (
    fileIndexFromUrl(left.referrerUrl) - fileIndexFromUrl(right.referrerUrl)
  ));
}

async function selectThumbnailFile(targetFileIndex, button, options) {
  if (fileIndexFromUrl(options.locationContext?.href) === targetFileIndex) {
    return true;
  }

  const before = snapshotKey(options.documentContext, options.locationContext);

  activateElement(button);

  return options.waitForChange({
    before,
    documentContext: options.documentContext,
    locationContext: options.locationContext,
  });
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

  while (attempts < options.maxItems && fileIndexFromUrl(options.locationContext?.href) > targetFileIndex) {
    attempts += 1;
    if (!await moveNavigation('Previous', options)) {
      break;
    }
  }

  while (attempts < options.maxItems && fileIndexFromUrl(options.locationContext?.href) < targetFileIndex) {
    attempts += 1;
    if (!await moveNavigation('Next', options)) {
      break;
    }
  }
}

async function moveNavigation(direction, {
  documentContext,
  locationContext,
  waitForChange,
}) {
  const button = findNavigationButton(documentContext, direction);

  if (button === null) {
    return false;
  }

  const before = snapshotKey(documentContext, locationContext);

  activateElement(button);

  return waitForChange({
    before,
    documentContext,
    locationContext,
  });
}

async function waitForDeviantArtChange({
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

    if (snapshotKey(documentContext, locationContext) !== before) {
      return true;
    }
  }

  return false;
}

function findNavigationButton(documentContext, label) {
  return queryAll(documentContext, 'button, [role="button"]')
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

  for (const image of queryAll(documentContext, 'section img')) {
    const button = image?.closest?.('button,[role="button"]') ?? null;

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
  const section = image?.closest?.('section') ?? null;
  const text = typeof section?.textContent === 'string' ? section.textContent.toLowerCase() : '';

  return text.includes('all images');
}

function findMainImage(documentContext) {
  return [...(documentContext?.images ?? queryAll(documentContext, 'img'))]
    .filter((image) => normalizeUrl(readImageSource(image)) !== null && isVisibleElement(image))
    .sort((left, right) => elementArea(right) - elementArea(left))[0] ?? null;
}

function readImageSource(image) {
  return image?.getAttribute?.('src') ?? image?.src ?? image?.currentSrc ?? null;
}

function readImageResolution(image) {
  const width = Number(image?.naturalWidth ?? 0);
  const height = Number(image?.naturalHeight ?? 0);

  return width > 0 && height > 0 ? `${width}x${height}` : null;
}

function snapshotKey(documentContext, locationContext) {
  const item = readCurrentDeviantArtBatchItem({ documentContext, locationContext });

  return [
    locationContext?.href ?? '',
    item?.asset?.source ?? '',
  ].join('|');
}

function fileIndexFromUrl(rawUrl) {
  try {
    const index = Number(new URL(rawUrl).searchParams.get('file'));

    return Number.isInteger(index) && index > 0 ? index : 1;
  } catch {
    return 1;
  }
}

function isDeviantArtDeviationUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);

    return url.hostname.endsWith('deviantart.com')
      && /\/[^/]+\/art\/[^/]+-\d+/.test(url.pathname);
  } catch {
    return false;
  }
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
