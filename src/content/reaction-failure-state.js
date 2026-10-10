import { normalizeDesktopRequestId } from '../shared/desktop-contract.js';
import { safeBrowserSessionFailureDetails } from '../shared/browser-session-error.js';

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
    DESKTOP_CAPABILITY_REQUIRED: 'Update Atlas Desktop and reconnect the extension, then retry.',
    BROWSER_SESSION_UNAVAILABLE: 'The browser session could not be captured. Refresh the page, check extension permissions, then retry.',
    BROWSER_SESSION_TOO_LARGE: 'The browser session exceeds supported limits. Reload the page and retry with fewer items.',
    BROWSER_SESSION_AMBIGUOUS: 'The browser returned conflicting session data. Refresh the page and retry.',
    BROWSER_SESSION_HEADERS_INVALID: 'The browser request headers could not be captured safely. Reload the page and retry.',
    BROWSER_SESSION_EXPIRED: 'The captured browser session expired. Reload the media on the page and retry.',
    EXTENSION_WORKER_UNAVAILABLE: 'The extension background worker is unavailable. Reload the extension and refresh the page.',
    EXTENSION_REQUEST_TIMEOUT: 'The extension did not finish the request in time. Check Desktop diagnostics before retrying; the reaction may already be saved.',
    EXTENSION_MESSAGE_FAILED: 'The extension could not deliver the request. Refresh the page and retry.',
    IDEMPOTENCY_CONFLICT: 'The retry no longer matches its original request. Start the reaction again.',
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
    BATCH_INCOMPLETE: 'Could not collect every gallery image. Already queued items remain saved. Retry after the gallery loads.',
    BATCH_CANCELLED: 'Gallery collection stopped. Already queued items remain saved. Use Retry to continue.',
    GALLERY_REQUEST_PENDING: 'Another gallery request is awaiting acknowledgement. Retry when it finishes.',
    BATCH_COLLECTION_BUSY: 'Another gallery operation is active. Wait for it to finish, or retry or close its progress panel.',
    BATCH_POST_CHANGED: 'The post changed. Start the batch again on the current post.',
    BATCH_PROVIDER_CHANGED: 'The gallery provider changed while collecting images. Start the batch again on the current post.',
    BATCH_PROVIDER_UNAVAILABLE: 'The gallery provider is unavailable. Check that its plugin is enabled in Desktop, then retry.',
    BATCH_TOO_LARGE: 'A request exceeded Desktop’s 50-item segment limit. Update the extension and retry the gallery.',
    BATCH_UNSUPPORTED_MEDIA: 'This gallery contains unsupported media. Turn off Batch to download items individually.',
    REACTION_REQUEST_FAILED: 'The reaction request failed. Retry, then check Desktop diagnostics if it continues.',
  };
  // Only fixed explanations, categories and UUID references reach the page. Server messages,
  // details, and unexpected codes can contain private provider or request data.
  const code = Object.hasOwn(messages, error?.code) ? error.code : 'REACTION_REQUEST_FAILED';
  const requestId = normalizeDesktopRequestId(error?.requestId ?? error?.request_id);
  const details = safeBrowserSessionFailureDetails(error);
  const explanation = details
    ? 'The browser denied Atlas access to this site’s cookies. In the extension’s Site access settings, grant permanent access to the page and its main domain, then reload and retry.'
    : messages[code];
  return {
    errorCode: code,
    failureStage: 'reaction',
    message: `${explanation} [${code}${requestId ? ` · Reference: ${requestId}` : ''}]`,
    retryable: error?.retryable === true,
    ...(requestId === null ? {} : { requestId }),
    ...(details ? { details } : {}),
  };
}

export function safePostReactionError(error) {
  if (error?.code === 'DESKTOP_OFFLINE') return 'Atlas Desktop is offline.';
  if (error?.code === 'DESKTOP_TIMEOUT') return 'Atlas Desktop did not respond.';
  return 'The reaction was saved, but the tab close action could not be prepared.';
}
