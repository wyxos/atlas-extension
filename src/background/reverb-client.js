export function normalizeDownloadEventPayload(message) {
  const data = message?.data;

  if (!data || typeof data !== 'object') {
    return null;
  }

  const assetUrl = stringOrNull(data.asset_url ?? data.assetUrl ?? data.original);

  if (assetUrl === null) {
    return null;
  }

  const referrerUrl = stringOrNull(data.referrer_url ?? data.referrerUrl);

  return {
    assetUrl,
    download: {
      downloaded_at: stringOrNull(data.downloaded_at),
      file_id: numberOrNull(data.file_id ?? data.fileId),
      progress_percent: numberOrNull(data.progress_percent ?? data.percent) ?? 0,
      status: stringOrNull(data.status),
    },
    file: normalizeFile(data.file, data.file_id ?? data.fileId),
    ...(referrerUrl === null ? {} : { referrerUrl }),
    reaction: normalizeReaction(data.reaction),
  };
}

function normalizeReaction(value) {
  if (typeof value === 'string' && value.trim() !== '') {
    return { type: value.trim() };
  }

  if (typeof value?.type === 'string' && value.type.trim() !== '') {
    return { type: value.type.trim() };
  }

  return null;
}

function normalizeFile(value, fallbackId) {
  const file = value && typeof value === 'object' ? value : {};
  const id = numberOrNull(file.id ?? fallbackId);

  if (id === null) {
    return null;
  }

  return {
    atlas_url: stringOrNull(file.atlas_url ?? file.atlasUrl),
    id,
  };
}

function stringOrNull(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();

  return trimmed === '' ? null : trimmed;
}

function numberOrNull(value) {
  const number = Number(value);

  return Number.isFinite(number) ? number : null;
}
