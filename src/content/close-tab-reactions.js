import {
  closeTabModes,
  loadCloseTabModeForSiteDomain,
  normalizeSiteDomain,
} from '../shared/close-tab-preferences.js';
import { armDownloadCloseIntentViaBackground } from './background-api.js';

export async function armCloseTabForReaction(payload, {
  loadModeForSiteDomain = loadCloseTabModeForSiteDomain,
  locationContext = globalThis.location,
  reactionType = null,
  sendIntent = armDownloadCloseIntentViaBackground,
} = {}) {
  const queuedAssetUrls = queuedAssetUrlsFromReactionPayload(payload);
  const isBlacklistReaction = reactionType === 'blacklist';
  const assetUrls = queuedAssetUrls.length > 0
    ? queuedAssetUrls
    : (isBlacklistReaction ? reactionAssetUrlsFromPayload(payload) : []);
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
    ...(queuedAssetUrls.length === 0 && isBlacklistReaction ? { waitForDownloads: false } : {}),
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
    .map(reactionAssetUrl)
    .filter((assetUrl) => assetUrl !== null))];
}

function reactionAssetUrlsFromPayload(payload) {
  const items = Array.isArray(payload?.items) ? payload.items : [payload];

  return [...new Set(items
    .map(reactionAssetUrl)
    .filter((assetUrl) => assetUrl !== null))];
}

function reactionAssetUrl(item) {
  for (const value of [item?.file?.url, item?.asset_url]) {
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim();
    }
  }

  return null;
}
