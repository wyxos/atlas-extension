import { getAssetTarget, getCurrentAssetSourcePreferences } from '../assets.js';
export function galleryMedia(image, spec, location) {
  const host = location?.hostname ?? (() => { try { return new URL(location?.href).hostname; } catch { return ''; } })();
  const explicit = getCurrentAssetSourcePreferences().profiles.some(profile => profile.domain === host.replace(/^www\./, ''));
  const asset = getAssetTarget(image, { siteDomain: host, ...(explicit ? {} : { imageSourcePreference: spec.sourceMode }),
    // A gallery video may acquire its URL through currentSrc after insertion.
    // Do not capture the page fallback while it is still loading. Ready blob
    // players retain the same extraction fallback as individual video capture.
    allowMediaPageFallback: Number(image?.readyState) >= 1 });
  if (!asset) return null;
  try {
    const url = new URL(asset.source);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (spec.mediaHosts?.length && (url.protocol !== 'https:' || !spec.mediaHosts.includes(url.hostname))) return null;
    return asset;
  } catch { return null; }
}
