import { normalizeComparableUrl } from '../shared/comparable-url.js';

const reactionTypes = new Set(['blacklist', 'funny', 'like', 'love']);
const openedElsewhereStatus = 'opened-elsewhere';
const currentPageStatus = 'current-page';

export function normalizeComparableReferrerUrl(value) {
  return normalizeComparableUrl(value);
}

export function hasAtlasReferrerState(state) {
  if (!state || typeof state !== 'object') {
    return false;
  }

  const reaction = normalizeReaction(state.reaction);

  return reaction !== null
    || hasText(state.blacklisted_at)
    || hasText(state.blacklistedAt);
}

export function resolveReferrerBadgeState({
  atlasState,
  currentPageUrl,
  openCounts,
  referrerUrl,
}) {
  if (hasAtlasReferrerState(atlasState)) {
    return atlasState;
  }

  const comparableReferrerUrl = normalizeComparableReferrerUrl(referrerUrl);

  if (comparableReferrerUrl === null) {
    return null;
  }

  if (comparableReferrerUrl === normalizeComparableReferrerUrl(currentPageUrl)) {
    return { referrerStatus: currentPageStatus };
  }

  if (openCountFor(openCounts, comparableReferrerUrl) > 0) {
    return { referrerStatus: openedElsewhereStatus };
  }

  return null;
}

export function shouldConfirmReferrerOpen({
  atlasState,
  currentPageUrl,
  openCounts,
  referrerUrl,
}) {
  if (hasAtlasReferrerState(atlasState)) {
    return 'reacted';
  }

  const comparableReferrerUrl = normalizeComparableReferrerUrl(referrerUrl);

  if (comparableReferrerUrl === null) {
    return null;
  }

  if (comparableReferrerUrl === normalizeComparableReferrerUrl(currentPageUrl)) {
    return openCountFor(openCounts, comparableReferrerUrl) > 1 ? 'opened-elsewhere' : null;
  }

  return openCountFor(openCounts, comparableReferrerUrl) > 0 ? 'opened-elsewhere' : null;
}

function normalizeReaction(reaction) {
  if (reactionTypes.has(reaction)) {
    return reaction;
  }

  return reactionTypes.has(reaction?.type) ? reaction.type : null;
}

function openCountFor(openCounts, url) {
  if (openCounts instanceof Map) {
    return Number(openCounts.get(url) ?? 0);
  }

  return Number(openCounts?.[url] ?? 0);
}

function hasText(value) {
  return typeof value === 'string' && value.trim() !== '';
}
