import {
  assetSourcePreferencesKey,
  createDefaultAssetSourcePreferences,
  imageSourcePreferenceValues,
  loadAssetSourcePreferences,
  normalizeAssetSourcePreferences,
  resolveAssetImageSourcePreference,
} from '../shared/asset-source-preferences.js';

const assetTypesByTag = new Map([
  ['AUDIO', 'audio'],
  ['IMG', 'image'],
  ['VIDEO', 'video'],
]);
let assetSourcePreferences = createDefaultAssetSourcePreferences();

export function getAssetType(element) {
  return assetTypesByTag.get(String(element?.tagName ?? '').toUpperCase()) ?? null;
}

export async function initializeAssetSourcePreferences({ onChanged = () => {} } = {}) {
  globalThis.chrome?.storage?.onChanged?.addListener?.((changes, areaName) => {
    if (areaName !== 'local' || changes?.[assetSourcePreferencesKey] === undefined) {
      return;
    }

    assetSourcePreferences = normalizeAssetSourcePreferences(
      changes[assetSourcePreferencesKey].newValue,
    );
    onChanged();
  });

  try {
    assetSourcePreferences = await loadAssetSourcePreferences();
    onChanged();
  } catch {
    // The scanner can continue with built-in defaults when extension storage is unavailable.
  }
}

export function getAssetSource(element, options = {}) {
  const tagName = String(element?.tagName ?? '').toUpperCase();

  if (tagName === 'IMG' && shouldUseHighestSrcsetCandidate(element, options)) {
    const srcsetSource = getHighestSrcsetSource(element);

    if (srcsetSource !== null) {
      return srcsetSource;
    }
  }

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

export function describeAssetElement(element, options = {}) {
  const type = getAssetType(element);

  if (type === null || isHiddenAssetElement(element)) {
    return null;
  }

  if (hasAnchorAncestor(element)) {
    return null;
  }

  const source = getAssetSource(element, options);

  if (source === null) {
    return null;
  }

  return {
    resolution: getAssetResolution(element),
    source,
    type,
  };
}

export function describeReferrerAssetElement(element, options = {}) {
  const type = getAssetType(element);

  if (type === null || isHiddenAssetElement(element)) {
    return null;
  }

  if (!hasAnchorAncestor(element)) {
    return null;
  }

  const referrerUrl = getAssetReferrerHref(element);

  if (referrerUrl === null) {
    return null;
  }

  const source = getAssetSource(element, options);

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

export function getAssetReferrerHref(element) {
  return normalizeAnchorHref(element?.closest?.('a[href]') ?? element?.closest?.('a'));
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

function shouldUseHighestSrcsetCandidate(element, options) {
  const sourcePreference = options?.imageSourcePreference
    ?? resolveAssetImageSourcePreference(
      options?.assetSourcePreferences ?? assetSourcePreferences,
      options?.siteDomain ?? element?.ownerDocument?.location?.hostname ?? globalThis.location?.hostname,
    );

  return sourcePreference === imageSourcePreferenceValues.highestSrcset;
}

function getHighestSrcsetSource(element) {
  const rawSrcset = typeof element?.getAttribute === 'function'
    ? element.getAttribute('srcset')
    : element?.srcset;
  const candidates = parseSrcsetCandidates(rawSrcset, element);

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => right.score - left.score);

  return candidates[0].source;
}

function parseSrcsetCandidates(srcset, element) {
  if (typeof srcset !== 'string' || srcset.trim() === '') {
    return [];
  }

  return srcset
    .split(',')
    .map((candidate) => parseSrcsetCandidate(candidate, element))
    .filter((candidate) => candidate !== null);
}

function parseSrcsetCandidate(candidate, element) {
  const parts = String(candidate ?? '').trim().split(/\s+/);

  if (parts.length === 0 || parts[0] === '') {
    return null;
  }

  const source = normalizeSource(parts[0], element);

  if (source === null) {
    return null;
  }

  return {
    score: parseSrcsetDescriptorScore(parts[1]),
    source,
  };
}

function parseSrcsetDescriptorScore(descriptor) {
  if (typeof descriptor !== 'string') {
    return 1;
  }

  if (descriptor.endsWith('w')) {
    return Number.parseFloat(descriptor.slice(0, -1)) || 1;
  }

  if (descriptor.endsWith('x')) {
    return Number.parseFloat(descriptor.slice(0, -1)) || 1;
  }

  return 1;
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
