export const desktopConnectionStorageKey = 'atlasDesktopConnection';

export const desktopCapabilities = Object.freeze({
  batchProviderPreference: 'batch-provider-preference',
  closeTabMode: 'close-tab-mode',
  browserProviders: 'browser-provider-resolution-v1',
  browserAuthenticatedDownload: 'browser-authenticated-download-v1',
});

export const requiredDesktopCapabilities = Object.freeze([
  desktopCapabilities.batchProviderPreference,
  desktopCapabilities.closeTabMode,
  desktopCapabilities.browserProviders,
  desktopCapabilities.browserAuthenticatedDownload,
]);

export function hasDesktopCapability(value, capability) {
  return normalizeDesktopCapabilities(value?.capabilities ?? value).includes(capability);
}

export function normalizeDesktopCapabilities(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value
    .map((capability) => typeof capability === 'string' ? capability.trim() : '')
    .filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

export async function loadDesktopCapabilities(storage = globalThis.chrome?.storage?.local) {
  if (typeof storage?.get !== 'function') {
    return [];
  }

  try {
    const result = await storage.get(desktopConnectionStorageKey);
    return normalizeDesktopCapabilities(result?.[desktopConnectionStorageKey]?.capabilities);
  } catch {
    return [];
  }
}

export function desktopCapabilitiesFromStorageChange(changes, areaName) {
  if (areaName !== 'local' || !(desktopConnectionStorageKey in (changes ?? {}))) {
    return null;
  }

  return normalizeDesktopCapabilities(
    changes[desktopConnectionStorageKey]?.newValue?.capabilities,
  );
}
