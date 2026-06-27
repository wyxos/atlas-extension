import { closeTabModes, normalizeCloseTabMode } from '../shared/close-tab-preferences.js';

const videoControlOffset = 48;
const compactBadgeHeight = 50;
const compactBadgeWidth = 40;

export function createBadgePresentation(asset, visibleRect, viewportPadding, state = {}, options = {}) {
  const download = normalizeDownloadState(state.download);
  const file = normalizeFileState(state.file);
  const blacklistedAt = stringOrNull(state.blacklisted_at ?? state.blacklistedAt);
  const progressPercent = resolveProgressPercent(download);
  const progressLabel = formatProgressLabel(download, progressPercent);
  const reaction = normalizeReaction(state.reaction);
  const activeReaction = blacklistedAt !== null ? 'blacklist' : reaction;
  const isDownloaded = isDownloadedState(download);

  return {
    activeReaction,
    atlasFileUrl: isDownloaded ? file?.atlas_url ?? null : null,
    batch: normalizeBatchState(state.batch),
    canDeleteFile: isDownloaded && file?.id !== null,
    ...optionalCloseTabState(state.closeTab),
    download,
    file,
    isBusy: state.isBusy === true,
    isDeleting: state.isDeleting === true,
    progressLabel,
    progressPercent,
    progressTone: resolveProgressTone(download),
    reaction,
    resolutionLabel: formatResolutionLabel(asset),
    source: asset.source,
    style: createBadgeStyle(visibleRect, viewportPadding, asset, options),
    submittingReaction: normalizeReaction(state.submittingReaction),
    timestampLabel: formatTimestamp(blacklistedAt ?? (isDownloaded ? download?.downloaded_at : null) ?? null),
    type: asset.type,
  };
}

export function createReferrerBadgePresentation(asset, visibleRect, viewportPadding, state = {}) {
  const download = normalizeDownloadState(state.download);
  const blacklistedAt = stringOrNull(state.blacklisted_at ?? state.blacklistedAt);
  const progressPercent = resolveProgressPercent(download);
  const reaction = normalizeReaction(state.reaction);
  const activeReaction = blacklistedAt !== null ? 'blacklist' : reaction;
  const referrerStatus = normalizeReferrerStatus(state.referrerStatus);

  return {
    activeReaction,
    download,
    progressPercent,
    progressTone: resolveProgressTone(download),
    referrerStatus: activeReaction === null ? referrerStatus : null,
    reaction,
    source: asset.source,
    style: createCompactBadgeStyle(visibleRect, viewportPadding, asset),
    variant: 'referrer',
  };
}

export function createBadgeStyle(visibleRect, viewportPadding, asset = {}, options = {}) {
  if (visibleRect === null) {
    return {
      display: 'none',
    };
  }

  const style = {
    display: 'flex',
    left: `${visibleRect.left + (visibleRect.width / 2)}px`,
    maxWidth: `${Math.max(180, visibleRect.width - (viewportPadding * 2))}px`,
    top: `${visibleRect.bottom - viewportPadding - badgeOffsetForAsset(asset)}px`,
  };

  if (options.placement === 'bottom-right') {
    style.left = `${visibleRect.left + visibleRect.width - viewportPadding}px`;
    style.transform = 'translate(-100%, -100%)';
  }

  return style;
}

function createCompactBadgeStyle(visibleRect, viewportPadding, asset = {}) {
  const style = createBadgeStyle(visibleRect, viewportPadding, asset, { placement: 'bottom-right' });

  if (style.display === 'none') {
    return style;
  }

  return {
    ...style,
    height: `${compactBadgeHeight}px`,
    maxWidth: `${compactBadgeWidth}px`,
    width: `${compactBadgeWidth}px`,
  };
}

export function formatResolutionLabel(asset) {
  return typeof asset.resolution === 'string' && asset.resolution.trim() !== ''
    ? asset.resolution
    : null;
}

function badgeOffsetForAsset(asset) {
  return asset?.type === 'video' ? videoControlOffset : 0;
}

function normalizeReaction(reaction) {
  if (isReactionType(reaction)) {
    return reaction;
  }

  if (isReactionType(reaction?.type)) {
    return reaction.type;
  }

  return null;
}

function normalizeDownloadState(download) {
  if (!download || typeof download !== 'object') {
    return null;
  }

  return {
    downloaded_at: typeof download.downloaded_at === 'string' ? download.downloaded_at : null,
    file_id: normalizePositiveInteger(download.file_id ?? download.fileId),
    progress_percent: normalizeProgress(download.progress_percent),
    status: typeof download.status === 'string' ? download.status : null,
  };
}

function normalizeBatchState(batch) {
  if (batch?.available !== true) {
    return null;
  }

  return {
    available: true,
    checked: batch.checked === true,
  };
}

function optionalCloseTabState(closeTab) {
  if (closeTab?.available !== true) {
    return {};
  }

  return {
    closeTab: {
      available: true,
      mode: normalizeCloseTabMode(closeTab.mode ?? closeTabModes.off),
    },
  };
}

function normalizeFileState(file) {
  if (!file || typeof file !== 'object') {
    return null;
  }

  return {
    atlas_url: typeof file.atlas_url === 'string' && file.atlas_url.trim() !== ''
      ? file.atlas_url
      : null,
    id: normalizePositiveInteger(file.id),
  };
}

function normalizeProgress(value) {
  const progress = Number(value);

  if (!Number.isFinite(progress)) {
    return 0;
  }

  return Math.min(100, Math.max(0, Math.round(progress)));
}

function resolveProgressPercent(download) {
  if (download === null) {
    return 0;
  }

  if (isCompletedState(download)) {
    return 100;
  }

  return download.progress_percent;
}

function formatProgressLabel(download, progressPercent) {
  if (download === null) {
    return '';
  }

  const status = isCompletedState(download)
    ? 'completed'
    : download.status ?? 'pending';

  return `${status} · ${progressPercent}%`;
}

function resolveProgressTone(download) {
  if (download === null) {
    return 'idle';
  }

  if (isCompletedState(download)) {
    return 'success';
  }

  if (download.status === 'failed') {
    return 'danger';
  }

  if (['paused', 'pending'].includes(download.status)) {
    return 'warning';
  }

  if (download.status === 'canceled') {
    return 'muted';
  }

  return 'active';
}

function isCompletedState(download) {
  if (download === null) {
    return false;
  }

  return download.status === 'completed'
    || (download.status === null && download.downloaded_at !== null);
}

function isDownloadedState(download) {
  return isCompletedState(download) && download?.downloaded_at !== null;
}

function formatTimestamp(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }

  const timestamp = new Date(value);

  if (Number.isNaN(timestamp.getTime())) {
    return null;
  }

  const month = pad2(timestamp.getMonth() + 1);
  const day = pad2(timestamp.getDate());
  const hours = pad2(timestamp.getHours());
  const minutes = pad2(timestamp.getMinutes());
  const seconds = pad2(timestamp.getSeconds());

  return `${month}-${day}-${timestamp.getFullYear()} ${hours}:${minutes}:${seconds}`;
}

function isReactionType(value) {
  return ['blacklist', 'funny', 'like', 'love'].includes(value);
}

function normalizeReferrerStatus(value) {
  return ['current-page', 'opened-elsewhere'].includes(value) ? value : null;
}

function normalizePositiveInteger(value) {
  const integer = Number(value);

  return Number.isInteger(integer) && integer > 0 ? integer : null;
}

function stringOrNull(value) {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function pad2(value) {
  return String(value).padStart(2, '0');
}
