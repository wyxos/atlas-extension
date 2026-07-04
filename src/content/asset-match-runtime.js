import { deriveAssetMatchIdentity } from '../shared/asset-match-identity.js';

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
    lookup_id: `${variant}:${targetKey}`,
  };
}
