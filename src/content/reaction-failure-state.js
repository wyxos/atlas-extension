export function applyAcceptedReactionPayload(payload, { applyBatch, applySingle }) {
  if (Array.isArray(payload?.items)) {
    applyBatch(payload);
  } else {
    applySingle(payload);
  }
}

export function reactionFailureFromError(error) {
  const code = typeof error?.code === 'string' ? error.code : 'REACTION_REQUEST_FAILED';
  const messages = {
    DESKTOP_OFFLINE: 'Atlas Desktop is offline',
    DESKTOP_TIMEOUT: 'Atlas Desktop did not respond',
    PAIRING_REQUIRED: 'Desktop pairing is required',
    BATCH_INCOMPLETE: 'Could not collect every gallery image. Nothing was queued. Try again after the gallery loads.',
    BATCH_POST_CHANGED: 'The post changed. Start the batch again on the current post.',
    BATCH_TOO_LARGE: 'This gallery exceeds the batch limit of 50 items.',
    BATCH_UNSUPPORTED_MEDIA: 'This gallery contains unsupported media. Turn off Batch to download items individually.',
  };
  return {
    errorCode: code,
    failureStage: 'reaction',
    message: messages[code] ?? 'Atlas Desktop rejected the request',
    retryable: error?.retryable === true,
  };
}

export function safePostReactionError(error) {
  if (error?.code === 'DESKTOP_OFFLINE') return 'Atlas Desktop is offline.';
  if (error?.code === 'DESKTOP_TIMEOUT') return 'Atlas Desktop did not respond.';
  return 'The reaction was saved, but the tab close action could not be prepared.';
}
