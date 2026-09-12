import { deriveReferrerMatchIdentity } from '../shared/asset-match-identity.js';

export const reactionPreviewTransport = {
  reaction: (_, body) => previewRequest('/v1/reactions', body),
  reactionBatch: (_, body) => previewRequest('/v1/reactions/batch', body),
};

function previewRequest(path, body) {
  return {
    method: 'POST', path,
    body: {
      ...body,
      ...(body.cookies ? { cookies: body.cookies.map((cookie) => ({ ...cookie, value: '[redacted]' })) } : {}),
    },
  };
}

export function postAssetReaction({
  asset,
  credentials,
  downloadAction,
  reactionType,
  useBrowserDownload,
  referrerUrl,
  runtimeContext,
  source,
  transport,
  preferences,
}) {
  const referrerIdentity = deriveReferrerMatchIdentity({ referrerUrl, preferences });
  return transport.reaction(credentials, {
    asset_url: asset.source,
    ...(asset.providerIdentity ? { provider_identity: asset.providerIdentity } : {}),
    ...(asset.matchIdentity ? { match_identity: asset.matchIdentity } : {}),
    ...(referrerIdentity ? { referrer_match_identity: referrerIdentity } : {}),
    ...(downloadAction ? { download_action: downloadAction } : {}),
    metadata: buildAssetMetadata(asset),
    referrer_url: referrerUrl,
    ...buildRuntimeContextPayload(runtimeContext),
    source,
    ...(useBrowserDownload === true ? { use_browser_download: true } : {}),
    type: reactionType,
  });
}

export function postAssetReactionBatch({
  preferences,
  credentials,
  downloadAction,
  items,
  reactionType,
  useBrowserDownload,
  runtimeContext,
  transport,
}) {
  return transport.reactionBatch(credentials, {
    ...(downloadAction ? { download_action: downloadAction } : {}),
    items: normalizeBatchItems(items, preferences),
    ...buildRuntimeContextPayload(runtimeContext),
    ...(useBrowserDownload === true ? { use_browser_download: true } : {}),
    type: reactionType,
  });
}

export function fetchAssetStatuses({
  assetUrls,
  credentials,
  matchItems,
  referrerUrls,
  transport,
}) {
  const uniqueAssetUrls = uniqueNonEmptyStrings(assetUrls);
  const uniqueMatchItems = uniqueStatusMatchItems(matchItems);
  const uniqueReferrerUrls = uniqueNonEmptyStrings(referrerUrls);

  if (uniqueAssetUrls.length === 0 && uniqueReferrerUrls.length === 0 && uniqueMatchItems.length === 0) {
    return { assets: {}, matches: {}, referrers: {} };
  }

  return transport.assetStatuses(credentials, {
    ...(uniqueAssetUrls.length > 0 ? { asset_urls: uniqueAssetUrls } : {}),
    ...(uniqueMatchItems.length > 0 ? { match_items: uniqueMatchItems } : {}),
    ...(uniqueReferrerUrls.length > 0 ? { referrer_urls: uniqueReferrerUrls } : {}),
  });
}

export function deleteAtlasFile({ credentials, fileId, transport }) {
  return transport.deleteFile(credentials, fileId);
}

export function openAtlasFile({ credentials, fileId, transport }) {
  return transport.openFile(credentials, fileId);
}

function buildAssetMetadata(asset) {
  // Browser dimensions are hints until Desktop probes the downloaded original.
  // Keep resolution for older Desktop versions; numeric fields are additive.
  const match = typeof asset.resolution === 'string'
    ? /^(\d+)x(\d+)$/.exec(asset.resolution.trim())
    : null;
  const width = match ? Number(match[1]) : null;
  const height = match ? Number(match[2]) : null;
  const validDimensions = [width, height].every((value) =>
    Number.isInteger(value) && value > 0 && value <= 0xFFFFFFFF);
  return Object.fromEntries(
    Object.entries({
      asset_type: asset.type,
      resolution: asset.resolution,
      ...(validDimensions ? { width, height } : {}),
    }).filter(([, value]) => value !== null && value !== undefined && value !== ''),
  );
}

function normalizeBatchItems(items, preferences) {
  return (items ?? []).map((item) => ({
    asset_url: item.asset?.source,
    ...(item.asset?.providerIdentity ? { provider_identity: item.asset.providerIdentity } : {}),
    ...(item.asset?.matchIdentity ? { match_identity: item.asset.matchIdentity } : {}),
    ...(item.referrerUrl ? { referrer_match_identity: deriveReferrerMatchIdentity({ referrerUrl: item.referrerUrl, preferences }) } : {}),
    metadata: buildAssetMetadata(item.asset ?? {}),
    referrer_url: item.referrerUrl,
    source: item.source,
  }));
}

function buildRuntimeContextPayload(runtimeContext) {
  const cookies = Array.isArray(runtimeContext?.cookies) ? runtimeContext.cookies : [];
  const userAgent = typeof runtimeContext?.user_agent === 'string'
    ? runtimeContext.user_agent.trim()
    : '';

  return {
    ...(cookies.length > 0 ? { cookies } : {}),
    ...(userAgent !== '' ? { user_agent: userAgent } : {}),
  };
}

function uniqueNonEmptyStrings(values) {
  return [...new Set(values)]
    .map((value) => String(value ?? '').trim())
    .filter((value) => value !== '');
}

function uniqueStatusMatchItems(values) {
  const itemsByLookupId = new Map();

  for (const item of values ?? []) {
    const normalized = normalizeStatusMatchItem(item);
    if (normalized !== null) {
      itemsByLookupId.set(normalized.lookup_id, normalized);
    }
  }

  return [...itemsByLookupId.values()];
}

function normalizeStatusMatchItem(item) {
  const lookupId = String(item?.lookup_id ?? '').trim();
  const matchBy = String(item?.match_by ?? '').trim();
  const matchUrl = String(item?.match_url ?? '').trim();

  if (lookupId === '' || !['source', 'referrer'].includes(matchBy) || matchUrl === '') {
    return null;
  }

  return Object.fromEntries(
    Object.entries({
      lookup_id: lookupId,
      match_by: matchBy,
      match_url: matchUrl,
      rule_digest: item?.rule_digest,
      rule_id: item?.rule_id,
      referrer_url: item?.referrer_url,
      asset_url: item?.asset_url,
      provider_identity: item?.provider_identity,
    }).filter(([, value]) => value !== null && value !== undefined && value !== ''),
  );
}
