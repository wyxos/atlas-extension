const assetTypesByTag = new Map([
  ['AUDIO', 'audio'],
  ['IMG', 'image'],
  ['VIDEO', 'video'],
]);
const ignoredAnchorSiblingAncestorTags = new Set(['BODY', 'HEAD', 'HTML', 'SCRIPT', 'STYLE']);
const maxAnchorSiblingAncestorDepth = 10;

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
  return hasAnchorSibling(element) || findAnchorSiblingAncestor(element) !== null;
}

export function getAssetReferrerHref(element) {
  return normalizeAnchorHref(element?.closest?.('a[href]') ?? element?.closest?.('a'))
    ?? getAnchorSiblingHref(element)
    ?? getAnchorSiblingAncestorHref(element);
}

function getAnchorSiblingAncestorHref(element) {
  for (const ancestor of listAnchorSiblingAncestors(element)) {
    const href = getAnchorSiblingHref(ancestor);

    if (href !== null) {
      return href;
    }
  }

  return null;
}

function findAnchorSiblingAncestor(element) {
  return listAnchorSiblingAncestors(element).find((ancestor) => hasAnchorSibling(ancestor)) ?? null;
}

function listAnchorSiblingAncestors(element) {
  const ancestors = [];
  let candidate = element?.parentElement;

  for (let depth = 0; candidate && depth < maxAnchorSiblingAncestorDepth; depth += 1) {
    if (isIgnoredAnchorSiblingAncestor(candidate)) {
      break;
    }

    ancestors.push(candidate);
    candidate = candidate.parentElement;
  }

  return ancestors;
}

function getAnchorSiblingHref(element) {
  for (const sibling of listAnchorSiblingElements(element)) {
    const href = normalizeAnchorHref(sibling);

    if (href !== null) {
      return href;
    }
  }

  return null;
}

function hasAnchorSibling(element) {
  return listAnchorSiblingElements(element).length > 0;
}

function listAnchorSiblingElements(element) {
  if (!element) {
    return [];
  }

  const candidates = [
    element.previousElementSibling,
    element.nextElementSibling,
    ...Array.from(element.parentElement?.children ?? []),
  ];
  const seen = new Set([element]);
  const siblings = [];

  for (const candidate of candidates) {
    if (seen.has(candidate)) {
      continue;
    }

    seen.add(candidate);
    if (isAnchorElement(candidate)) {
      siblings.push(candidate);
    }
  }

  return siblings;
}

function isAnchorElement(element) {
  return String(element?.tagName ?? '').toUpperCase() === 'A';
}

function isIgnoredAnchorSiblingAncestor(element) {
  return ignoredAnchorSiblingAncestorTags.has(String(element?.tagName ?? '').toUpperCase());
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
