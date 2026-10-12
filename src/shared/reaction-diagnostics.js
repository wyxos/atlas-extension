import { normalizeDesktopRequestId } from './desktop-contract.js';

export const reactionDiagnosticCapability = 'extension-diagnostics-v1';
export const reactionDiagnosticReasonCapability = 'extension-diagnostics-reasons-v1';
export const reactionDiagnosticCookieFlagCapability = 'extension-diagnostics-cookie-flags-v1';
export const reactionCookieConflictFlags = Object.freeze(['SECURE', 'HTTP_ONLY', 'HOST_ONLY']);
export const reactionConflictReasons = Object.freeze([
  'COOKIE_VALUE_CONFLICT', 'COOKIE_SECURITY_ATTRIBUTE_CONFLICT',
  'HEADER_AUTHORIZATION_CONFLICT', 'HEADER_CUSTOM_CONFLICT',
]);
export const reactionMessageTypes = ['atlas-extension.asset-reaction', 'atlas-extension.asset-reaction-batch'];
export const reactionFailureCodes = Object.freeze([
  'BROWSER_SESSION_UNAVAILABLE', 'BROWSER_SESSION_TOO_LARGE', 'BROWSER_SESSION_AMBIGUOUS',
  'BROWSER_SESSION_HEADERS_INVALID', 'BROWSER_SESSION_EXPIRED', 'DESKTOP_CAPABILITY_REQUIRED',
  'EXTENSION_WORKER_UNAVAILABLE', 'EXTENSION_REQUEST_TIMEOUT', 'EXTENSION_MESSAGE_FAILED',
  'DESKTOP_OFFLINE', 'DESKTOP_TIMEOUT', 'PAIRING_REQUIRED', 'INVALID_RESPONSE',
  'REACTION_REQUEST_FAILED', 'GALLERY_REQUEST_PENDING', 'IDEMPOTENCY_CONFLICT',
]);

export function reactionRequestId(value) {
  return normalizeDesktopRequestId(value) ?? globalThis.crypto.randomUUID();
}

// Only host-owned categories and UUID references can be retained or relayed.
export function safeReactionDiagnostic(value) {
  const requestId = normalizeDesktopRequestId(value?.requestId);
  if (!requestId) return null;
  const reason = value?.code === 'BROWSER_SESSION_AMBIGUOUS' && value?.phase === 'preparing-session'
    && reactionConflictReasons.includes(value?.reason) ? value.reason : undefined;
  const cookieFlags = reason === 'COOKIE_SECURITY_ATTRIBUTE_CONFLICT' && Array.isArray(value?.cookieFlags)
    && value.cookieFlags.length > 0 && value.cookieFlags.length <= reactionCookieConflictFlags.length
    && [...value.cookieFlags].every(flag => reactionCookieConflictFlags.includes(flag))
    && new Set(value.cookieFlags).size === value.cookieFlags.length
    ? reactionCookieConflictFlags.filter(flag => value.cookieFlags.includes(flag)) : undefined;
  return {
    requestId,
    observedAt: typeof value?.observedAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.observedAt)
      && Number.isFinite(Date.parse(value.observedAt)) ? value.observedAt : new Date().toISOString(),
    code: reactionFailureCodes.includes(value?.code) ? value.code : 'REACTION_REQUEST_FAILED',
    phase: ['preparing-session', 'sending-request', 'background-message'].includes(value?.phase)
      ? value.phase : 'background-message',
    operation: value?.operation === 'reaction-batch' ? 'reaction-batch' : 'reaction',
    ...(reason ? { reason } : {}),
    ...(cookieFlags ? { cookieFlags } : {}),
  };
}

export function reactionDiagnosticFromError(error, { requestId, operation } = {}) {
  return safeReactionDiagnostic({ requestId: error?.requestId ?? requestId, code: error?.code,
    phase: typeof error?.code === 'string' && error.code.startsWith('BROWSER_SESSION') ? 'preparing-session' : 'sending-request',
    operation, reason: error?.details?.reason, cookieFlags: error?.details?.cookieFlags });
}
