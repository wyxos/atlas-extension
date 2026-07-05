import {
  loadConnectionConfig,
  normalizeDomain,
} from '../options/connection.js';

const extensionBasePath = '/api/extension';

export async function loadAtlasContentConfig(storage, options = {}) {
  return loadConnectionConfig(storage, options);
}

export async function postAssetReaction({
  asset,
  config,
  downloadAction,
  fetchImpl = globalThis.fetch,
  reactionType,
  requestTimeoutMs,
  referrerUrl,
  runtimeContext,
  source,
}) {
  return atlasExtensionJson({
    body: {
      asset_url: asset.source,
      ...(asset.matchIdentity ? { match_identity: asset.matchIdentity } : {}),
      ...(downloadAction ? { download_action: downloadAction } : {}),
      metadata: buildAssetMetadata(asset),
      referrer_url: referrerUrl,
      ...buildRuntimeContextPayload(runtimeContext),
      source,
      type: reactionType,
    },
    config,
    fetchImpl,
    method: 'POST',
    path: '/reactions',
    requestTimeoutMs,
  });
}

export async function postAssetReactionBatch({
  config,
  downloadAction,
  fetchImpl = globalThis.fetch,
  items,
  reactionType,
  requestTimeoutMs,
  runtimeContext,
}) {
  return atlasExtensionJson({
    body: {
      ...(downloadAction ? { download_action: downloadAction } : {}),
      items: normalizeBatchItems(items),
      ...buildRuntimeContextPayload(runtimeContext),
      type: reactionType,
    },
    config,
    fetchImpl,
    method: 'POST',
    path: '/reactions/batch',
    requestTimeoutMs,
  });
}

export async function fetchAssetStatuses({
  assetUrls,
  config,
  fetchImpl = globalThis.fetch,
  matchItems,
  referrerUrls,
  requestTimeoutMs,
}) {
  const uniqueAssetUrls = uniqueNonEmptyStrings(assetUrls);
  const uniqueMatchItems = uniqueStatusMatchItems(matchItems);
  const uniqueReferrerUrls = uniqueNonEmptyStrings(referrerUrls);

  if (uniqueAssetUrls.length === 0 && uniqueReferrerUrls.length === 0 && uniqueMatchItems.length === 0) {
    return { assets: {}, referrers: {} };
  }

  return atlasExtensionJson({
    body: {
      ...(uniqueAssetUrls.length > 0 ? { asset_urls: uniqueAssetUrls } : {}),
      ...(uniqueMatchItems.length > 0 ? { match_items: uniqueMatchItems } : {}),
      ...(uniqueReferrerUrls.length > 0 ? { referrer_urls: uniqueReferrerUrls } : {}),
    },
    config,
    fetchImpl,
    method: 'POST',
    path: '/assets/status',
    requestTimeoutMs,
  });
}

export async function deleteAtlasFile({
  config,
  fetchImpl = globalThis.fetch,
  fileId,
  requestTimeoutMs,
}) {
  const normalizedFileId = Number(fileId);

  if (!Number.isInteger(normalizedFileId) || normalizedFileId <= 0) {
    throw new Error('Atlas file id is required.');
  }

  return atlasExtensionJson({
    body: {
      also_delete_record: true,
      also_from_disk: true,
    },
    config,
    fetchImpl,
    method: 'DELETE',
    path: `/files/${normalizedFileId}`,
    requestTimeoutMs,
  });
}

async function atlasExtensionJson({
  body,
  config,
  fetchImpl,
  method,
  path,
  requestTimeoutMs = 10000,
}) {
  const domain = normalizeDomain(config?.domain);
  const apiKey = String(config?.apiKey ?? '').trim();

  if (domain === null || apiKey === '' || typeof fetchImpl !== 'function') {
    throw new Error('Atlas extension connection is not configured.');
  }

  const controller = typeof globalThis.AbortController === 'function'
    ? new globalThis.AbortController()
    : null;
  const timeoutId = controller !== null
    ? globalThis.setTimeout(() => controller.abort(), requestTimeoutMs)
    : null;

  try {
    const response = await fetchImpl(`${domain}${extensionBasePath}${path}`, {
      body: JSON.stringify(body),
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Atlas-Api-Key': apiKey,
      },
      method,
      signal: controller?.signal,
    });
    const payload = await readJson(response);

    if (!response.ok) {
      throw new Error(payload?.message ?? 'Atlas extension request failed.');
    }

    return payload ?? {};
  } finally {
    if (timeoutId !== null) {
      globalThis.clearTimeout(timeoutId);
    }
  }
}

function buildAssetMetadata(asset) {
  const metadata = {
    asset_type: asset.type,
    resolution: asset.resolution,
  };

  return Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => value !== null && value !== undefined && value !== ''),
  );
}

function normalizeBatchItems(items) {
  return (items ?? []).map((item) => ({
    asset_url: item.asset?.source,
    ...(item.asset?.matchIdentity ? { match_identity: item.asset.matchIdentity } : {}),
    metadata: buildAssetMetadata(item.asset ?? {}),
    referrer_url: item.referrerUrl,
    source: item.source,
  }));
}

function buildRuntimeContextPayload(runtimeContext) {
  const cookies = Array.isArray(runtimeContext?.cookies)
    ? runtimeContext.cookies
    : [];
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
    }).filter(([, value]) => value !== null && value !== undefined && value !== ''),
  );
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
