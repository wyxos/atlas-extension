import {
  assetMatchByValues,
  assetMatchQueryCleanupModes,
  getAssetSourceProfile,
} from './asset-source-preferences.js';

export function deriveAssetMatchIdentity({
  asset,
  pageUrl,
  preferences,
  referrerUrl,
  siteDomain,
}) {
  const rawSourceUrl = normalizeHttpUrl(asset?.source);
  const rawReferrerUrl = normalizeHttpUrl(referrerUrl ?? asset?.referrerUrl ?? pageUrl);
  const profile = getAssetSourceProfile(preferences, siteDomain);
  const matching = profile?.asset?.matching;
  const matchBy = matching?.matchBy === assetMatchByValues.referrer
    ? assetMatchByValues.referrer
    : assetMatchByValues.source;
  const selectedUrl = matchBy === assetMatchByValues.referrer ? rawReferrerUrl : rawSourceUrl;
  const matchUrl = applyAssetMatchCleanup(selectedUrl, matching?.cleanup);

  return {
    matchIdentity: matchUrl === null ? null : withoutEmptyValues({
      match_by: matchBy,
      match_url: matchUrl,
      rule_digest: assetMatchRuleDigest({ matching, siteDomain }),
      rule_id: matching?.ruleId,
    }),
    rawReferrerUrl,
    rawSourceUrl,
  };
}

export function applyAssetMatchCleanup(rawUrl, cleanup) {
  const normalizedUrl = normalizeHttpUrl(rawUrl);
  if (normalizedUrl === null) {
    return null;
  }

  let url;
  try {
    url = new URL(normalizedUrl);
  } catch {
    return normalizedUrl;
  }

  if (cleanup?.removeFragment === true) {
    url.hash = '';
  }

  const query = cleanup?.query;
  const mode = query?.mode ?? assetMatchQueryCleanupModes.none;
  const params = normalizeQueryParams(query?.params);

  if (mode === assetMatchQueryCleanupModes.stripAll) {
    url.search = '';
  } else if (mode === assetMatchQueryCleanupModes.stripSelected) {
    for (const param of params) {
      url.searchParams.delete(param);
    }
  } else if (mode === assetMatchQueryCleanupModes.keepSelected && params.length > 0) {
    const kept = new globalThis.URLSearchParams();
    for (const [key, value] of url.searchParams.entries()) {
      if (params.includes(key.toLowerCase())) {
        kept.append(key, value);
      }
    }
    url.search = kept.toString();
  }

  return url.href;
}

export function assetMatchRuleDigest({ matching, siteDomain }) {
  const value = stableStringify({
    cleanup: matching?.cleanup ?? null,
    matchBy: matching?.matchBy ?? assetMatchByValues.source,
    ruleId: matching?.ruleId ?? '',
    siteDomain: normalizeDomain(siteDomain),
  });
  let hash = 5381;

  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(index)) >>> 0;
  }

  return `rule-${hash.toString(36)}`;
}

function normalizeHttpUrl(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed === '') {
    return null;
  }

  try {
    const url = new URL(trimmed);

    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function normalizeDomain(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().toLowerCase().replace(/^www\./, '');
}

function normalizeQueryParams(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(
    value
      .map((param) => String(param ?? '').trim().toLowerCase())
      .filter((param) => param !== ''),
  )];
}

function withoutEmptyValues(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== null && item !== undefined && item !== ''),
  );
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableStringify(value[key])}`
    )).join(',')}}`;
  }

  return JSON.stringify(value);
}
