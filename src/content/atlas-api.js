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
  fetchImpl = globalThis.fetch,
  reactionType,
  requestTimeoutMs,
  referrerUrl,
  source,
}) {
  return atlasExtensionJson({
    body: {
      asset_url: asset.source,
      metadata: buildAssetMetadata(asset),
      referrer_url: referrerUrl,
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

export async function fetchAssetStatuses({
  assetUrls,
  config,
  fetchImpl = globalThis.fetch,
  referrerUrls,
  requestTimeoutMs,
}) {
  const uniqueAssetUrls = uniqueNonEmptyStrings(assetUrls);
  const uniqueReferrerUrls = uniqueNonEmptyStrings(referrerUrls);

  if (uniqueAssetUrls.length === 0 && uniqueReferrerUrls.length === 0) {
    return { assets: {}, referrers: {} };
  }

  return atlasExtensionJson({
    body: {
      ...(uniqueAssetUrls.length > 0 ? { asset_urls: uniqueAssetUrls } : {}),
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

function uniqueNonEmptyStrings(values) {
  return [...new Set(values)]
    .map((value) => String(value ?? '').trim())
    .filter((value) => value !== '');
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
