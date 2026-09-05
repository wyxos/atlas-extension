import { deriveAssetMatchIdentity } from '../shared/asset-match-identity.js';
import { civitaiPage } from '../shared/civitai-page.js';

export function decorateAssetWithMatchIdentity({
  asset,
  pageUrl,
  preferences,
  referrerUrl,
  siteDomain,
}) {
  const result = deriveAssetMatchIdentity({
    asset,
    pageUrl,
    preferences,
    referrerUrl,
    siteDomain,
  });

  return result.matchIdentity === null
    ? asset
    : {
        ...asset,
        matchIdentity: result.matchIdentity,
        ...(civitaiPage(result.rawReferrerUrl) ? { providerReferrerUrl: result.rawReferrerUrl } : {}),
      };
}

export function statusMatchItemForAsset(asset, variant) {
  if (!asset?.matchIdentity) {
    return null;
  }

  const targetKey = variant === 'referrer' ? asset.referrerUrl : asset.source;
  if (typeof targetKey !== 'string' || targetKey.trim() === '') {
    return null;
  }

  return {
    ...asset.matchIdentity,
    lookup_id: lookupIdForTarget(variant, targetKey),
    ...(variant === 'asset' && asset.providerReferrerUrl ? {
      referrer_url: asset.providerReferrerUrl,
      asset_url: asset.source,
    } : {}),
  };
}

function lookupIdForTarget(variant, targetKey) {
  return `${variant}:${stableLookupHash(`${variant}\n${targetKey}`)}`;
}

function stableLookupHash(value) {
  let hash = 5381;

  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(index)) >>> 0;
  }

  return hash.toString(36);
}
