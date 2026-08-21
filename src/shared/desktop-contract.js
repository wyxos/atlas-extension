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
  return desktopChannelBases[resolveExtensionChannel(channel)];
}

export function assertDesktopChannel(data, expectedChannel = resolveExtensionChannel()) {
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

export function createDesktopContractError(code, message, retryable = false, details = undefined) {
  const error = new Error(message);
  error.code = code;
  error.retryable = retryable;

  if (details !== undefined) {
    error.details = details;
  }

  return error;
}

export function serializeDesktopError(error, fallbackMessage = 'Atlas Desktop request failed.') {
  return {
    code: typeof error?.code === 'string' ? error.code : 'DESKTOP_REQUEST_FAILED',
    details: error?.details && typeof error.details === 'object' ? error.details : undefined,
    message: error?.message ?? fallbackMessage,
    retryable: error?.retryable === true,
  };
}

function injectedExtensionChannel() {
  return typeof globalThis.__ATLAS_DESKTOP_CHANNEL__ === 'string'
    ? globalThis.__ATLAS_DESKTOP_CHANNEL__
    : desktopChannels.dev;
}
