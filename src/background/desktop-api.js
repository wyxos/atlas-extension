import { deriveReferrerMatchIdentity } from '../shared/asset-match-identity.js';
import { createDesktopContractError } from '../shared/desktop-contract.js';

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
      ...(body.browser_session ? { browser_session: { ...body.browser_session,
        request_headers: body.browser_session.request_headers.map(scope => ({ ...scope,
          headers: scope.headers.map(header => ({ ...header, value: '[redacted]' })),
        })),
      } } : {}),
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
  idempotencyKey,
  items,
  reactionType,
  useBrowserDownload,
  runtimeContext,
  transport,
}) {
  const body = prepareBatchReactionBody({
    preferences, downloadAction, items, reactionType, useBrowserDownload, runtimeContext,
  });
  return idempotencyKey === undefined
    ? transport.reactionBatch(credentials, body)
    : transport.reactionBatch(credentials, body, { idempotencyKey });
}

function prepareBatchReactionBody({ preferences, downloadAction, items, reactionType, useBrowserDownload, runtimeContext }) {
  return {
    ...(downloadAction ? { download_action: downloadAction } : {}),
    items: normalizeBatchItems(items, preferences),
    ...buildRuntimeContextPayload(runtimeContext),
    ...(useBrowserDownload === true ? { use_browser_download: true } : {}),
    type: reactionType,
  };
}

// Keep only recent chunks, including acknowledged chunks whose content reply may
// have been lost. Cookies and source rules are captured once for an exact retry.
export function createBatchReactionPoster({ maxPreparedRequests = 16 } = {}) {
  const preparedRequests = new Map();
  let activeScope = null;

  async function post(options) {
    const { credentials, idempotencyKey, prepareContext, tabId, transport } = options;
    if (idempotencyKey === undefined || options.previewOnly === true) {
      return postAssetReactionBatch({ ...options, ...await prepareContext() });
    }
    const scope = JSON.stringify([transport.baseUrl, credentials?.clientId]);
    if (activeScope !== scope) {
      // One background runtime has one active pairing/channel. A retired
      // identity cannot retry these requests or reserve the new identity's slot.
      preparedRequests.clear();
      activeScope = scope;
    }
    if (options.acknowledgedIdempotencyKey !== undefined) {
      acknowledge({ tabId, idempotencyKey: options.acknowledgedIdempotencyKey });
    }
    const cacheKey = JSON.stringify([transport.baseUrl, credentials?.clientId, tabId, idempotencyKey]);
    const identity = JSON.stringify([
      options.items, options.downloadAction, options.reactionType, options.useBrowserDownload === true,
    ]);
    let cached = preparedRequests.get(cacheKey);
    if (cached && cached.identity !== identity) {
      throw createDesktopContractError('IDEMPOTENCY_CONFLICT', 'The reaction retry no longer matches its original chunk.', false);
    }
    if (!cached) {
      if (tabId !== undefined && [...preparedRequests.values()].some((entry) => entry.tabId === tabId && !entry.acknowledged)) {
        throw createDesktopContractError('GALLERY_REQUEST_PENDING', 'The previous gallery request needs acknowledgement before continuing.', true);
      }
      while (preparedRequests.size >= Math.max(1, maxPreparedRequests)) {
        const acknowledged = [...preparedRequests].find(([, entry]) => entry.acknowledged);
        if (!acknowledged) {
          throw createDesktopContractError('GALLERY_REQUEST_PENDING', 'Earlier gallery requests are still awaiting acknowledgement. Retry in a moment.', true);
        }
        preparedRequests.delete(acknowledged[0]);
      }
      cached = {
        acknowledged: false,
        idempotencyKey,
        identity,
        tabId,
        body: Promise.resolve().then(async () => JSON.parse(JSON.stringify(prepareBatchReactionBody({
          ...options, ...await prepareContext(),
        })))),
      };
    }
    preparedRequests.delete(cacheKey);
    preparedRequests.set(cacheKey, cached);
    let body;
    try {
      body = await cached.body;
    } catch (error) {
      if (preparedRequests.get(cacheKey) === cached) preparedRequests.delete(cacheKey);
      throw error;
    }
    try {
      return await transport.reactionBatch(credentials, body, { idempotencyKey });
    } catch (error) {
      if (error?.retryable === false) cached.acknowledged = true;
      throw error;
    }
  }

  function acknowledge({ tabId, idempotencyKey }) {
    for (const entry of preparedRequests.values()) {
      if (entry.tabId === tabId && entry.idempotencyKey === idempotencyKey) entry.acknowledged = true;
    }
  }

  post.acknowledge = acknowledge;
  post.removeTab = (tabId) => {
    for (const [key, entry] of preparedRequests) {
      if (entry.tabId === tabId) preparedRequests.delete(key);
    }
  };
  return post;
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
      top_page_url: asset.topPageUrl,
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
    ...(runtimeContext?.browser_session ? { browser_session: runtimeContext.browser_session } : {}),
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
