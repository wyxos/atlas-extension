import {
  assetSourcePreferencesKey,
  createDefaultAssetSourcePreferences,
  imageSourcePreferenceValues,
  loadAssetSourcePreferences,
  normalizeAssetSourcePreferences,
  resolveAssetImageSourcePreference,
} from '../shared/asset-source-preferences.js';
import { shouldSkipAssetElement } from './background-backed-assets.js';

const assetTypesByTag = new Map([
  ['AUDIO', 'audio'],
  ['IMG', 'image'],
  ['VIDEO', 'video'],
]);
const hiddenOpacityThreshold = 0.5;
let assetSourcePreferences = createDefaultAssetSourcePreferences();
const atlasManagedOpacityElements = new WeakSet();

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

export function getCurrentAssetSourcePreferences() {
  return assetSourcePreferences;
}

export function markAtlasManagedOpacity(element) {
  if (typeof element === 'object' && element !== null) {
    atlasManagedOpacityElements.add(element);
  }
}

export function clearAtlasManagedOpacity(element) {
  if (typeof element === 'object' && element !== null) {
    atlasManagedOpacityElements.delete(element);
  }
}

export function getAssetSource(element, options = {}) {
  return getAssetTarget(element, options)?.source ?? null;
}

function getAssetTarget(element, options = {}) {
  const tagName = String(element?.tagName ?? '').toUpperCase();

  if (tagName === 'IMG' && shouldUseHighestSrcsetCandidate(element, options)) {
    const srcsetCandidate = getHighestSrcsetCandidate(element);

    if (srcsetCandidate !== null) {
      return describeAssetTarget(element, srcsetCandidate);
    }
  }

  const declaredSource = normalizeDeclaredSource(element);
  const nestedSource = normalizeSource(element?.querySelector?.('source[src]')?.src);
  const responsiveSource = normalizeSource(element?.currentSrc);
  const directSource = declaredSource ?? nestedSource ?? responsiveSource;

  if (directSource !== null) {
    return describeAssetTarget(element, { source: directSource });
  }

  const shadowHostTarget = getShadowHostAssetTarget(element);

  if (shadowHostTarget !== null) {
    return describeAssetTarget(element, shadowHostTarget);
  }

  if (['AUDIO', 'VIDEO'].includes(tagName)) {
    const pageSource = normalizeSource(element?.ownerDocument?.location?.href ?? globalThis.location?.href);

    return pageSource === null ? null : describeAssetTarget(element, { source: pageSource });
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

  if (type === null || hasAnchorAncestor(element)) {
    return null;
  }

  const assetTarget = getAssetTarget(element, options);

  if (assetTarget === null || shouldSkipAsset({
    element,
    source: assetTarget.source,
    type,
  })) {
    return null;
  }

  return {
    resolution: assetTarget.resolution,
    source: assetTarget.source,
    type,
  };
}

export function describeReferrerAssetElement(element, options = {}) {
  const type = getAssetType(element);

  if (type === null || !hasAnchorAncestor(element)) {
    return null;
  }

  const referrerUrl = getAssetReferrerHref(element);

  if (referrerUrl === null) {
    return null;
  }

  const assetTarget = getAssetTarget(element, options);

  if (assetTarget === null || shouldSkipAsset({
    element,
    source: assetTarget.source,
    type,
  })) {
    return null;
  }

  return {
    referrerUrl,
    resolution: assetTarget.resolution,
    source: assetTarget.source,
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

function describeAssetTarget(element, target) {
  return {
    resolution: getAssetTargetResolution(element, target),
    source: target.source,
  };
}

function getAssetTargetResolution(element, target) {
  const resolution = getResolutionFromDimensions(
    getTargetDimensions(target),
    getIntrinsicDimensions(element),
  );

  if (resolution !== null) {
    return resolution;
  }

  return canUseElementResolutionForTarget(element, target) || target.allowIntrinsicResolution === true
    ? getAssetResolution(element)
    : null;
}

function getTargetDimensions(target) {
  const sourceDimensions = getSourceDimensions(target.source);

  return {
    height: sourceDimensions.height ?? target.height ?? null,
    width: sourceDimensions.width ?? target.width ?? null,
  };
}

function getSourceDimensions(source) {
  try {
    const url = new URL(source);

    return {
      height: getUrlDimension(url, ['height', 'h']) ?? getPathDimension(url.pathname, 'h'),
      width: getUrlDimension(url, ['width', 'w']) ?? getPathDimension(url.pathname, 'w'),
    };
  } catch {
    return {
      height: null,
      width: null,
    };
  }
}

function getUrlDimension(url, keys) {
  for (const key of keys) {
    const dimension = normalizeDimension(url.searchParams.get(key));

    if (dimension !== null) {
      return dimension;
    }
  }

  return null;
}

function getPathDimension(pathname, key) {
  const match = String(pathname ?? '').match(new RegExp(`(?:^|[/,_-])${key}[_=](\\d+)(?=$|[/,_.-])`, 'i'));

  return normalizeDimension(match?.[1]);
}

function getResolutionFromDimensions(dimensions, intrinsicDimensions) {
  const width = normalizeDimension(dimensions?.width);
  const height = normalizeDimension(dimensions?.height);

  if (width !== null && height !== null) {
    return `${width}x${height}`;
  }

  if (intrinsicDimensions === null) {
    return null;
  }

  if (width !== null) {
    return `${width}x${Math.round((width * intrinsicDimensions.height) / intrinsicDimensions.width)}`;
  }

  if (height !== null) {
    return `${Math.round((height * intrinsicDimensions.width) / intrinsicDimensions.height)}x${height}`;
  }

  return null;
}

function normalizeDimension(value) {
  const dimension = Number.parseInt(value, 10);

  return Number.isFinite(dimension) && dimension > 0 ? dimension : null;
}

function getIntrinsicDimensions(element) {
  const width = Number(element?.naturalWidth ?? element?.videoWidth ?? 0);
  const height = Number(element?.naturalHeight ?? element?.videoHeight ?? 0);

  if (width <= 0 || height <= 0) {
    return null;
  }

  return { height, width };
}

function canUseElementResolutionForTarget(element, target) {
  const currentSource = normalizeSource(element?.currentSrc, element);

  if (currentSource !== null) {
    return currentSource === target.source;
  }

  return normalizeDeclaredSource(element) === target.source;
}

function getShadowHostAssetTarget(element) {
  for (const host of getShadowHosts(element)) {
    const source = normalizeDeclaredSource(host)
      ?? normalizeSource(host?.currentSrc, host)
      ?? normalizeSource(host?.querySelector?.('source[src]')?.src, host);

    if (source !== null) {
      return {
        allowIntrinsicResolution: true,
        source,
      };
    }
  }

  return null;
}

function getShadowHosts(element) {
  const hosts = [];
  let root = element?.getRootNode?.();

  while (root?.host) {
    hosts.push(root.host);
    root = root.host.getRootNode?.();
  }

  return hosts;
}

function getHighestSrcsetCandidate(element) {
  const rawSrcset = typeof element?.getAttribute === 'function'
    ? element.getAttribute('srcset')
    : element?.srcset;
  const candidates = parseSrcsetCandidates(rawSrcset, element);

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => right.score - left.score);

  return candidates[0];
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
    ...parseSrcsetDescriptor(parts[1]),
    source,
  };
}

function parseSrcsetDescriptor(descriptor) {
  if (typeof descriptor !== 'string') {
    return {
      score: 1,
      width: null,
    };
  }

  if (descriptor.endsWith('w')) {
    const width = normalizeDimension(descriptor.slice(0, -1));

    return {
      score: width ?? 1,
      width,
    };
  }

  if (descriptor.endsWith('x')) {
    return {
      score: Number.parseFloat(descriptor.slice(0, -1)) || 1,
      width: null,
    };
  }

  return {
    score: 1,
    width: null,
  };
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

function shouldSkipAsset({
  element,
  source,
  type,
}) {
  return shouldSkipAssetElement({
    element,
    source,
    type,
  }, {
    atlasManagedOpacityElements,
    hiddenOpacityThreshold,
  });
}
