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
