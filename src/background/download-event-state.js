export function createDownloadEventState() {
  const statesByAssetUrl = new Map();

  return {
    accept(payload) {
      const assetUrl = normalizeString(payload?.assetUrl);

      if (assetUrl === null || !payload?.download || typeof payload.download !== 'object') {
        return null;
      }

      const incoming = normalizeDownloadState(payload.download);
      const current = statesByAssetUrl.get(assetUrl);

      if (current !== undefined && isStale(current, incoming)) {
        return null;
      }

      const generationAdvanced = current !== undefined && isNewerGeneration(current, incoming);
      const identityAdvanced = current !== undefined && isNewerTransfer(current, incoming);
      const allowReset = current === undefined || generationAdvanced || identityAdvanced;
      const progress = allowReset
        ? incoming.progress
        : maxNullable(current.progress, incoming.progress);
      const next = {
        attempt: generationAdvanced || identityAdvanced
          ? incoming.attempt
          : maxNullable(current?.attempt ?? null, incoming.attempt),
        generation: identityAdvanced
          ? incoming.generation
          : maxNullable(current?.generation ?? null, incoming.generation),
        progress,
        transferId: incoming.transferId ?? current?.transferId ?? null,
      };

      statesByAssetUrl.set(assetUrl, next);

      return {
        ...payload,
        download: {
          ...payload.download,
          ...(progress === null ? {} : { progress_percent: progress }),
        },
      };
    },
  };
}

function isStale(current, incoming) {
  if (
    current.transferId !== null
    && incoming.transferId !== null
    && incoming.transferId < current.transferId
  ) {
    return true;
  }

  if (
    current.transferId === incoming.transferId
    && current.generation !== null
    && incoming.generation !== null
    && incoming.generation < current.generation
  ) {
    return true;
  }

  return current.transferId === incoming.transferId
    && current.generation === incoming.generation
    && current.attempt !== null
    && incoming.attempt !== null
    && incoming.attempt < current.attempt;
}

function isNewerGeneration(current, incoming) {
  return current.transferId === incoming.transferId
    && incoming.generation !== null
    && (current.generation === null || incoming.generation > current.generation);
}

function isNewerTransfer(current, incoming) {
  return incoming.transferId !== null
    && (current.transferId === null || incoming.transferId > current.transferId);
}

function normalizeDownloadState(download) {
  return {
    attempt: normalizeCounter(download.attempt),
    generation: normalizeCounter(download.generation),
    progress: normalizeProgress(download.progress_percent),
    transferId: normalizeCounter(download.transfer_id ?? download.transferId),
  };
}

function normalizeCounter(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const counter = Number(value);
  return Number.isSafeInteger(counter) && counter >= 0 ? counter : null;
}

function normalizeProgress(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const progress = Number(value);
  return Number.isFinite(progress) ? Math.min(100, Math.max(0, Math.round(progress))) : null;
}

function normalizeString(value) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized === '' ? null : normalized;
}

function maxNullable(left, right) {
  if (left === null) return right;
  if (right === null) return left;
  return Math.max(left, right);
}
