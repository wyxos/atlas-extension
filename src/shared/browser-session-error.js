// Chrome includes the denied URL in this error. Retain only its fixed category.
export function cookieAccessFailureDetails(error) {
  return typeof error?.message === 'string'
    && error.message.startsWith('No host permissions for cookies at url:')
    ? { reason: 'HOST_PERMISSION_DENIED' } : undefined;
}

export function safeBrowserSessionFailureDetails(error) {
  return error?.code === 'BROWSER_SESSION_UNAVAILABLE'
    && error?.details?.reason === 'HOST_PERMISSION_DENIED'
    ? { reason: 'HOST_PERMISSION_DENIED' } : undefined;
}
