const backgroundRecoveryAncestorDepth = 5;
const minimumBackgroundSize = 24;

export function shouldSkipAssetElement({
  element,
  source,
  type,
}, {
  atlasManagedOpacityElements,
  hiddenOpacityThreshold,
} = {}) {
  const hiddenReason = hiddenAssetElementReason(element, {
    atlasManagedOpacityElements,
    hiddenOpacityThreshold,
  });

  if (hiddenReason === null) {
    return false;
  }

  if (hiddenReason !== 'low-opacity' || type !== 'image') {
    return true;
  }

  return !hasVisibleBackgroundBackingImage(element, source, {
    hiddenOpacityThreshold,
  });
}

function hasVisibleBackgroundBackingImage(element, source, {
  hiddenOpacityThreshold,
}) {
  const normalizedSource = normalizeSource(source, element);

  if (normalizedSource === null) {
    return false;
  }

  for (const candidate of nearbyBackgroundCandidates(element)) {
    if (!isVisibleBackgroundElement(candidate, { hiddenOpacityThreshold })) {
      continue;
    }

    const backgroundSource = normalizeSource(
      singleBackgroundImageUrl(styleFor(candidate)?.backgroundImage),
      candidate,
    );

    if (backgroundSource === normalizedSource && rectsAlign(element, candidate)) {
      return true;
    }
  }

  return false;
}

function hiddenAssetElementReason(element, {
  atlasManagedOpacityElements,
  hiddenOpacityThreshold,
} = {}) {
  if (!element) {
    return 'missing';
  }

  const hiddenAttribute = typeof element.getAttribute === 'function'
    ? element.getAttribute('hidden')
    : null;

  if (element.hidden === true || hiddenAttribute !== null) {
    return 'hidden';
  }

  const style = styleFor(element);
  const display = style?.display ?? element.style?.display;
  const visibility = style?.visibility ?? element.style?.visibility;
  const opacity = style?.opacity ?? element.style?.opacity;

  if (display === 'none') {
    return 'display';
  }

  if (['hidden', 'collapse'].includes(visibility)) {
    return 'visibility';
  }

  return isConfiguredLowOpacity(opacity, element, {
    atlasManagedOpacityElements,
    hiddenOpacityThreshold,
  })
    ? 'low-opacity'
    : null;
}

function isVisibleBackgroundElement(element, {
  hiddenOpacityThreshold,
}) {
  if (hiddenAssetElementReason(element, { hiddenOpacityThreshold }) !== null) {
    return false;
  }

  const style = styleFor(element);
  if (isBlurred(style?.filter ?? element?.style?.filter)) {
    return false;
  }

  return hasUsableRect(rectFor(element))
    && singleBackgroundImageUrl(style?.backgroundImage) !== null;
}

function nearbyBackgroundCandidates(element) {
  const candidates = [];
  const seen = new Set([element]);
  let root = element?.parentElement;
  let depth = 0;

  while (root && depth < backgroundRecoveryAncestorDepth) {
    collectCandidate(root, candidates, seen);
    for (const child of descendantsFor(root)) {
      collectCandidate(child, candidates, seen);
    }

    root = root.parentElement;
    depth += 1;
  }

  return candidates;
}

function descendantsFor(element) {
  if (typeof element?.querySelectorAll === 'function') {
    return Array.from(element.querySelectorAll('*'));
  }

  return descendantsFromChildren(element);
}

function descendantsFromChildren(element) {
  const descendants = [];
  const pending = Array.from(element?.children ?? []);

  while (pending.length > 0) {
    const current = pending.shift();
    descendants.push(current);
    pending.push(...Array.from(current?.children ?? []));
  }

  return descendants;
}

function collectCandidate(element, candidates, seen) {
  if (!element || seen.has(element)) {
    return;
  }

  seen.add(element);
  candidates.push(element);
}

function singleBackgroundImageUrl(backgroundImage) {
  if (typeof backgroundImage !== 'string') {
    return null;
  }

  const match = backgroundImage.trim().match(/^url\((?:"([^"]+)"|'([^']+)'|([^)]*))\)$/i);

  return match === null ? null : (match[1] ?? match[2] ?? match[3] ?? '').trim();
}

function rectsAlign(element, candidate) {
  const elementRect = rectFor(element);
  const candidateRect = rectFor(candidate);

  if (!hasUsableRect(elementRect) || !hasUsableRect(candidateRect)) {
    return false;
  }

  return containsRect(candidateRect, elementRect)
    || containsRect(elementRect, candidateRect)
    || overlapRatio(elementRect, candidateRect) >= 0.85;
}

function containsRect(outer, inner) {
  return inner.left >= outer.left
    && inner.right <= outer.right
    && inner.top >= outer.top
    && inner.bottom <= outer.bottom;
}

function overlapRatio(left, right) {
  const width = Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left));
  const height = Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
  const overlapArea = width * height;
  const smallestArea = Math.min(areaFor(left), areaFor(right));

  return smallestArea <= 0 ? 0 : overlapArea / smallestArea;
}

function areaFor(rect) {
  return rect.width * rect.height;
}

function hasUsableRect(rect) {
  return rect !== null
    && rect.width >= minimumBackgroundSize
    && rect.height >= minimumBackgroundSize;
}

function rectFor(element) {
  if (typeof element?.getBoundingClientRect !== 'function') {
    return null;
  }

  return element.getBoundingClientRect();
}

function isConfiguredLowOpacity(opacity, element, {
  atlasManagedOpacityElements,
  hiddenOpacityThreshold,
}) {
  if (opacity === undefined || opacity === null || String(opacity).trim() === '') {
    return false;
  }

  const numericOpacity = Number.parseFloat(opacity);

  return Number.isFinite(numericOpacity)
    && numericOpacity < hiddenOpacityThreshold
    && !atlasManagedOpacityElements?.has?.(element);
}

function isBlurred(filter) {
  return typeof filter === 'string' && /\bblur\(/i.test(filter);
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

function normalizeSource(source, element = null) {
  if (typeof source !== 'string') {
    return null;
  }

  const trimmed = source.trim();

  if (trimmed.length === 0) {
    return null;
  }

  try {
    const baseUrl = element?.ownerDocument?.baseURI
      ?? element?.ownerDocument?.location?.href
      ?? globalThis.location?.href;
    const url = typeof baseUrl === 'string' ? new URL(trimmed, baseUrl) : new URL(trimmed);

    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
