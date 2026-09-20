import { normalizeDesktopRequestId } from '../shared/desktop-contract.js';

export function applyAcceptedReactionPayload(payload, { applyBatch, applySingle }) {
  if (Array.isArray(payload?.items)) {
    applyBatch(payload);
  } else {
    applySingle(payload);
  }
}

export function reactionFailureFromError(error) {
  const messages = {
    PROVIDER_RESOLUTION_FAILED: 'Atlas could not resolve this media with its provider plugin. Check the plugin and account in Desktop, then retry.',
    DESKTOP_OFFLINE: 'Atlas Desktop is offline. Open Desktop and retry.',
    DESKTOP_TIMEOUT: 'Atlas Desktop did not respond. Check Desktop before retrying.',
    PAIRING_REQUIRED: 'Pair the extension with Atlas Desktop, then retry.',
    CLIENT_REVOKED: 'The Desktop pairing was revoked. Pair the extension again.',
    INVALID_CLIENT: 'The Desktop pairing is no longer valid. Pair the extension again.',
    UNAUTHORIZED: 'Desktop could not authorize this request. Pair the extension again.',
    CHANNEL_MISMATCH: 'Use the Atlas Desktop build that matches this extension.',
    PROTOCOL_MISMATCH: 'Update Atlas Desktop and the extension to compatible versions.',
    DATABASE_UNAVAILABLE: 'The Desktop library is unavailable. Check its service status in Settings, then retry.',
    IDEMPOTENCY_REQUIRED: 'The request is missing its retry identity. Update the extension and try again.',
    INVALID_REACTION: 'Desktop could not read the reaction request. Update Desktop and the extension, then retry.',
    INVALID_REACTION_BATCH: 'Desktop could not read the batch request. Update Desktop and the extension, then retry.',
    REACTION_BATCH_FAILED: 'Desktop could not accept the batch. Check Desktop diagnostics for this error.',
    REACTION_FAILED: 'Desktop could not accept the reaction. Check Desktop diagnostics for this error.',
    INVALID_RESPONSE: 'Desktop returned an unreadable response. Check Desktop and retry.',
    REQUEST_CANCELLED: 'The Desktop request was cancelled. Start the reaction again.',
    BATCH_INCOMPLETE: 'Could not collect every gallery image. Nothing was queued. Try again after the gallery loads.',
    BATCH_POST_CHANGED: 'The post changed. Start the batch again on the current post.',
    BATCH_PROVIDER_CHANGED: 'The gallery provider changed while collecting images. Start the batch again on the current post.',
    BATCH_PROVIDER_UNAVAILABLE: 'The gallery provider is unavailable. Check that its plugin is enabled in Desktop, then retry.',
    BATCH_TOO_LARGE: 'This gallery exceeds the batch limit of 50 items.',
    BATCH_UNSUPPORTED_MEDIA: 'This gallery contains unsupported media. Turn off Batch to download items individually.',
    REACTION_REQUEST_FAILED: 'The reaction request failed. Retry, then check Desktop diagnostics if it continues.',
  };
  // Only fixed explanations and UUID references reach the page. Server messages,
  // details, and unexpected codes can contain private provider or request data.
  const code = Object.hasOwn(messages, error?.code) ? error.code : 'REACTION_REQUEST_FAILED';
  const requestId = normalizeDesktopRequestId(error?.requestId ?? error?.request_id);
  return {
    errorCode: code,
    failureStage: 'reaction',
    message: `${messages[code]} [${code}${requestId ? ` · Reference: ${requestId}` : ''}]`,
    retryable: error?.retryable === true,
    ...(requestId === null ? {} : { requestId }),
  };
}

export function safePostReactionError(error) {
  if (error?.code === 'DESKTOP_OFFLINE') return 'Atlas Desktop is offline.';
  if (error?.code === 'DESKTOP_TIMEOUT') return 'Atlas Desktop did not respond.';
  return 'The reaction was saved, but the tab close action could not be prepared.';
}
