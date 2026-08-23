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
  const reactionFailure = normalizeReactionFailure(state.reactionFailure);
  const activeReaction = blacklistedAt !== null ? 'blacklist' : reaction;
  const isDownloaded = isDownloadedState(download);

  return {
    activeReaction,
    batch: normalizeBatchState(state.batch),
    canDeleteFile: isDownloaded && file?.id !== null,
    canOpenFile: isDownloaded && file?.id !== null,
    ...optionalCloseTabState(state.closeTab),
    download,
    file,
    ...optionalString('closeTabModeError', state.closeTabModeError),
    ...optionalFailureMessage(reactionFailure, download),
    isBusy: state.isBusy === true,
    isDeleting: state.isDeleting === true,
    progressLabel,
    progressPercent,
    progressTone: resolveProgressTone(download),
    ...optionalPortalTarget(options.portalTarget),
    reaction,
    ...(reactionFailure === null ? {} : { reactionFailure }),
    resolutionLabel: formatResolutionLabel(asset),
    source: asset.source,
    style: options.badgeStyle ?? createBadgeStyle(visibleRect, viewportPadding, asset, options),
    submittingReaction: normalizeReaction(state.submittingReaction),
    timestampLabel: formatTimestamp(blacklistedAt ?? (isDownloaded ? download?.downloaded_at : null) ?? null),
    type: asset.type,
  };
}

export function createReferrerBadgePresentation(asset, visibleRect, viewportPadding, state = {}, options = {}) {
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
    ...optionalPortalTarget(options.portalTarget),
    referrerStatus: activeReaction === null ? referrerStatus : null,
    reaction,
    source: asset.source,
    style: options.badgeStyle ?? createCompactBadgeStyle(visibleRect, viewportPadding, asset),
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

  const errorCode = stringOrNull(download.error_code ?? download.errorCode);
  const failureStage = stringOrNull(download.failure_stage ?? download.failureStage);
  const retryDisposition = ['canceled', 'retryable', 'terminal'].includes(
    download.retry_disposition ?? download.retryDisposition,
  ) ? download.retry_disposition ?? download.retryDisposition : null;

  return {
    downloaded_at: typeof download.downloaded_at === 'string' ? download.downloaded_at : null,
    file_id: normalizePositiveInteger(download.file_id ?? download.fileId),
    progress_percent: normalizeProgress(download.progress_percent),
    status: typeof download.status === 'string' ? download.status : null,
    ...(errorCode === null ? {} : { error_code: errorCode }),
    ...(failureStage === null ? {} : { failure_stage: failureStage }),
    ...(Number.isInteger(Number(download.attempt)) ? { attempt: Number(download.attempt) } : {}),
    ...(Number.isInteger(Number(download.generation)) ? { generation: Number(download.generation) } : {}),
    ...(retryDisposition === null ? {} : { retry_disposition: retryDisposition }),
    ...(typeof download.retryable === 'boolean' ? { retryable: download.retryable } : {}),
    ...(normalizePositiveInteger(download.transfer_id ?? download.transferId) === null ? {} : {
      transfer_id: normalizePositiveInteger(download.transfer_id ?? download.transferId),
    }),
  };
}

function normalizeReactionFailure(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }
  return {
    errorCode: stringOrNull(value.errorCode ?? value.error_code) ?? 'REACTION_REQUEST_FAILED',
    failureStage: 'reaction',
    message: stringOrNull(value.message) ?? 'Atlas Desktop rejected the request',
    retryable: value.retryable === true,
  };
}

function normalizeBatchState(batch) {
  if (batch?.available !== true) {
    return null;
  }

  return {
    available: true,
    checked: batch.checked === true,
    ...(typeof batch.supported === 'boolean' ? { supported: batch.supported } : {}),
    ...(batch.saving === true ? { saving: true } : {}),
    ...optionalString('error', batch.error),
    ...optionalString('unsupportedMessage', batch.unsupportedMessage),
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
      supported: closeTab.supported !== false,
      ...(typeof closeTab.unsupportedMessage === 'string' && closeTab.unsupportedMessage.trim() !== '' ? {
        unsupportedMessage: closeTab.unsupportedMessage.trim(),
      } : {}),
      ...(closeTab.saving === true ? { saving: true } : {}),
    },
  };
}

function optionalPortalTarget(portalTarget) {
  return portalTarget ? { portalTarget } : {};
}

function normalizeFileState(file) {
  if (!file || typeof file !== 'object') {
    return null;
  }

  return {
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

  if (download.retry_disposition === 'retryable') {
    return Number.isInteger(download.attempt)
      ? `Reaction saved · Download retrying · Attempt ${download.attempt}`
      : 'Reaction saved · Download retrying';
  }

  if (download.status === 'failed') {
    return 'Reaction saved · Download failed';
  }

  if (download.status === 'canceled') {
    return 'Download canceled';
  }

  const status = isCompletedState(download)
    ? 'completed'
    : download.status ?? 'pending';

  return `${status} · ${progressPercent}%`;
}

function optionalFailureMessage(reactionFailure, download) {
  if (reactionFailure !== null) {
    return { failureMessage: `Reaction not saved · ${reactionFailure.message}` };
  }
  if (download?.status !== 'failed') {
    return {};
  }
  const detail = ({
    access_denied: 'Source access denied',
    download_failed: 'Download attempt failed',
    media_processing: 'Media processing failed',
    network: 'Network problem',
    rate_limited: 'Source rate limit reached',
    source_not_found: 'Source file unavailable',
    storage: 'Storage failed',
  })[download.error_code] ?? 'Download attempt failed';
  return { failureMessage: detail };
}

function optionalString(key, value) {
  const normalized = stringOrNull(value);
  return normalized === null ? {} : { [key]: normalized };
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
