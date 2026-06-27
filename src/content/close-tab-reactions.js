import {
  closeTabModes,
  loadCloseTabModeForSiteDomain,
  normalizeSiteDomain,
} from '../shared/close-tab-preferences.js';
import { armDownloadCloseIntentViaBackground } from './background-api.js';

export async function armCloseTabForReaction(payload, {
  loadModeForSiteDomain = loadCloseTabModeForSiteDomain,
  locationContext = globalThis.location,
  sendIntent = armDownloadCloseIntentViaBackground,
} = {}) {
  const assetUrls = queuedAssetUrlsFromReactionPayload(payload);
  const siteDomain = normalizeSiteDomain(locationContext?.href);

  if (assetUrls.length === 0 || siteDomain === null) {
    return null;
  }

  const mode = await loadModeForSiteDomain(siteDomain);

  if (mode === closeTabModes.off) {
    return null;
  }

  const intent = {
    assetUrls,
    mode,
    siteDomain,
  };

  await sendIntent(intent);

  return intent;
}

export function queuedAssetUrlsFromReactionPayload(payload) {
  if (Array.isArray(payload?.items)) {
    return uniqueQueuedAssetUrls(payload.items);
  }

  return uniqueQueuedAssetUrls([payload]);
}

function uniqueQueuedAssetUrls(items) {
  return [...new Set(items
    .filter((item) => item?.download?.requested === true)
    .map(downloadAssetUrl)
    .filter((assetUrl) => assetUrl !== null))];
}

function downloadAssetUrl(item) {
  for (const value of [item?.file?.url, item?.asset_url]) {
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim();
    }
  }

  return null;
}
