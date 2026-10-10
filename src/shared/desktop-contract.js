export const desktopProtocolVersion = 1;

export const desktopChannels = Object.freeze({
  dev: 'dev',
  stable: 'stable',
});

export const desktopChannelBases = Object.freeze({
  [desktopChannels.dev]: 'http://127.0.0.1:17420',
  [desktopChannels.stable]: 'http://127.0.0.1:37420',
});

export const desktopMessageTypes = Object.freeze({
  cancelPairing: 'atlas-extension.desktop.cancel-pairing',
  diagnostics: 'atlas-extension.desktop.diagnostics',
  openFile: 'atlas-extension.desktop.open-file',
  openBrowserContainer: 'atlas-extension.desktop.open-browser-container',
  updateBatchProviderPreference: 'atlas-extension.desktop.update-batch-provider-preference',
  updateCloseTabMode: 'atlas-extension.desktop.update-close-tab-mode',
  updateWidgetPlacement: 'atlas-extension.desktop.update-widget-placement',
  pair: 'atlas-extension.desktop.pair',
  reconnect: 'atlas-extension.desktop.reconnect',
  resyncRequired: 'atlas-extension.desktop.resync-required',
  unpair: 'atlas-extension.desktop.unpair',
});

export function resolveExtensionChannel(value = injectedExtensionChannel()) {
  return value === desktopChannels.stable ? desktopChannels.stable : desktopChannels.dev;
}

export function desktopBaseForChannel(channel = resolveExtensionChannel()) {
  if (globalThis.__ATLAS_TEST_CONNECTION__) {
    if (channel !== 'dev') throw createDesktopContractError('TEST_RUNTIME_MISMATCH', 'A test extension requires its isolated runtime.');
    return globalThis.__ATLAS_TEST_CONNECTION__.baseUrl;
  }
  return desktopChannelBases[resolveExtensionChannel(channel)];
}

export function assertDesktopChannel(data, expectedChannel = resolveExtensionChannel()) {
  if (globalThis.__ATLAS_TEST_CONNECTION__
    && data?.app?.runtime_id !== globalThis.__ATLAS_TEST_CONNECTION__.runtimeId) {
    throw createDesktopContractError('TEST_RUNTIME_MISMATCH', 'The dedicated Atlas test runtime is required.');
  }
  const actualChannel = data?.app?.channel;

  if (actualChannel !== expectedChannel) {
    throw createDesktopContractError(
      'CHANNEL_MISMATCH',
      `Atlas Desktop ${expectedChannel} is required, but ${actualChannel || 'an unknown channel'} responded.`,
      false,
      { actual_channel: actualChannel ?? null, expected_channel: expectedChannel },
    );
  }
}

export function assertDesktopProtocol(data) {
  if (data?.protocol_version !== desktopProtocolVersion) {
    throw createDesktopContractError(
      'PROTOCOL_MISMATCH',
      `Atlas Desktop protocol ${desktopProtocolVersion} is required.`,
      false,
      {
        actual_protocol_version: data?.protocol_version ?? null,
        expected_protocol_version: desktopProtocolVersion,
      },
    );
  }
}

export function createDesktopContractError(code, message, retryable = false, details = undefined, requestId = undefined) {
  const error = new Error(message);
  error.code = code;
  error.retryable = retryable;

  if (details !== undefined) {
    error.details = details;
  }
  const reference = normalizeDesktopRequestId(requestId);
  if (reference !== null) error.requestId = reference;

  return error;
}

export function isDesktopPairingRequiredError(error) {
  return ['PAIRING_REQUIRED', 'CLIENT_REVOKED', 'INVALID_CLIENT', 'UNAUTHORIZED'].includes(error?.code);
}

export function serializeDesktopError(error, fallbackMessage = 'Atlas Desktop request failed.') {
  const requestId = normalizeDesktopRequestId(error?.requestId ?? error?.request_id);
  return {
    code: typeof error?.code === 'string' ? error.code : 'DESKTOP_REQUEST_FAILED',
    details: error?.details && typeof error.details === 'object' ? error.details : undefined,
    message: error?.message ?? fallbackMessage,
    retryable: error?.retryable === true,
    ...(requestId === null ? {} : { requestId }),
  };
}

export function normalizeDesktopRequestId(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value.toLowerCase()
    : null;
}

function injectedExtensionChannel() {
  return typeof globalThis.__ATLAS_DESKTOP_CHANNEL__ === 'string'
    ? globalThis.__ATLAS_DESKTOP_CHANNEL__
    : desktopChannels.dev;
}
