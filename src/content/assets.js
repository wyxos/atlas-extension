const assetTypesByTag = new Map([
  ['AUDIO', 'audio'],
  ['IMG', 'image'],
  ['VIDEO', 'video'],
]);

export function getAssetType(element) {
  return assetTypesByTag.get(String(element?.tagName ?? '').toUpperCase()) ?? null;
}

export function getAssetSource(element) {
  const tagName = String(element?.tagName ?? '').toUpperCase();
  const declaredSource = normalizeDeclaredSource(element);
  const nestedSource = normalizeSource(element?.querySelector?.('source[src]')?.src);
  const responsiveSource = normalizeSource(element?.currentSrc);
  const directSource = declaredSource ?? nestedSource ?? responsiveSource;

  if (directSource !== null) {
    return directSource;
  }

  if (['AUDIO', 'VIDEO'].includes(tagName)) {
    return normalizeSource(element?.ownerDocument?.location?.href ?? globalThis.location?.href);
  }

  return null;
}

export function getAssetResolution(element) {
  const width = Number(element?.naturalWidth ?? element?.videoWidth ?? 0);
  const height = Number(element?.naturalHeight ?? element?.videoHeight ?? 0);

  if (width <= 0 || height <= 0) {
    return null;
  }

  return `${width}x${height}`;
}

export function describeAssetElement(element) {
  const type = getAssetType(element);

  if (type === null || isHiddenAssetElement(element)) {
    return null;
  }

  if (hasAnchorAncestor(element) || hasNearbyAnchorSibling(element)) {
    return null;
  }

  const source = getAssetSource(element);

  if (source === null) {
    return null;
  }

  return {
    resolution: getAssetResolution(element),
    source,
    type,
  };
}

export function describeReferrerAssetElement(element) {
  const type = getAssetType(element);

  if (type === null || isHiddenAssetElement(element)) {
    return null;
  }

  if (!hasAnchorAncestor(element) && !hasNearbyAnchorSibling(element)) {
    return null;
  }

  const referrerUrl = getAssetReferrerHref(element);

  if (referrerUrl === null) {
    return null;
  }

  const source = getAssetSource(element);

  if (source === null) {
    return null;
  }

  return {
    referrerUrl,
    resolution: getAssetResolution(element),
    source,
    type,
  };
}

export function hasAnchorAncestor(element) {
  return Boolean(element?.closest?.('a'));
}

export function hasNearbyAnchorSibling(element) {
  return hasAnchorSibling(element) || hasAnchorSibling(element?.parentElement);
}

export function getAssetReferrerHref(element) {
  return normalizeAnchorHref(element?.closest?.('a[href]') ?? element?.closest?.('a'))
    ?? getAnchorSiblingHref(element)
    ?? getAnchorSiblingHref(element?.parentElement);
}

function getAnchorSiblingHref(element) {
  return normalizeAnchorHref(element?.previousElementSibling)
    ?? normalizeAnchorHref(element?.nextElementSibling);
}

function hasAnchorSibling(element) {
  return isAnchorElement(element?.previousElementSibling)
    || isAnchorElement(element?.nextElementSibling);
}

function isAnchorElement(element) {
  return String(element?.tagName ?? '').toUpperCase() === 'A';
}

function normalizeAnchorHref(element) {
  if (!isAnchorElement(element)) {
    return null;
  }

  return normalizeSource(element.href ?? element.getAttribute?.('href'));
}

function normalizeDeclaredSource(element) {
  const rawAttribute = element?.getAttribute?.('src');

  if (typeof rawAttribute === 'string') {
    return rawAttribute.trim() === '' ? null : normalizeSource(element?.src ?? rawAttribute);
  }

  return normalizeSource(element?.src);
}

function isHiddenAssetElement(element) {
  if (!element) {
    return true;
  }

  const hiddenAttribute = typeof element.getAttribute === 'function'
    ? element.getAttribute('hidden')
    : null;

  if (element.hidden === true || hiddenAttribute !== null) {
    return true;
  }

  const style = styleFor(element);
  const display = style?.display ?? element.style?.display;
  const visibility = style?.visibility ?? element.style?.visibility;
  const opacity = style?.opacity ?? element.style?.opacity;

  return display === 'none'
    || ['hidden', 'collapse'].includes(visibility)
    || Number.parseFloat(opacity) === 0;
}

function styleFor(element) {
  const view = element?.ownerDocument?.defaultView ?? globalThis;
  const getComputedStyle = view?.getComputedStyle ?? globalThis.getComputedStyle;

  if (typeof getComputedStyle !== 'function') {
    return element?.style ?? null;
  }

  try {
    return getComputedStyle.call(view, element);
  } catch {
    return element?.style ?? null;
  }
}

function normalizeSource(source) {
  if (typeof source !== 'string') {
    return null;
  }

  const trimmed = source.trim();

  if (trimmed.length === 0) {
    return null;
  }

  try {
    const url = new URL(trimmed);

    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
