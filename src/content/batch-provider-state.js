import {
  batchProviderPreferencesFromStorageChange,
  loadBatchProviderPreferences,
} from './batch-provider-preferences.js';
import {
  desktopCapabilities,
  desktopCapabilitiesFromStorageChange,
  hasDesktopCapability,
  loadDesktopCapabilities,
} from '../shared/desktop-capabilities.js';

const unsupportedMessage = 'Update Atlas Desktop to change batch mode.';

export function createBatchProviderState({
  getContextsById,
  onBadgeState,
  onStorageChanged = globalThis.chrome?.storage?.onChanged,
  savePreference,
  storage,
} = {}) {
  const enabledByProvider = new Map();
  const errorsByProvider = new Map();
  const savingProviders = new Set();
  let isBound = false;
  let supported = false;

  async function initialize() {
    bindStorageChanges();
    const [preferences, capabilities] = await Promise.all([
      loadBatchProviderPreferences(storage),
      loadDesktopCapabilities(storage),
    ]);

    replacePreferences(preferences, { update: false });
    supported = hasDesktopCapability(
      capabilities,
      desktopCapabilities.batchProviderPreference,
    );
    updateAll();
  }

  function isProviderEnabled(provider) {
    return typeof provider === 'string' && enabledByProvider.get(provider) === true;
  }

  function setProviderEnabled(provider, enabled) {
    const normalizedProvider = normalizeProvider(provider);

    if (normalizedProvider === null) {
      return;
    }

    if (enabled === true) {
      enabledByProvider.set(normalizedProvider, true);
    } else {
      enabledByProvider.delete(normalizedProvider);
    }
  }

  async function changeProvider(provider, enabled) {
    const normalizedProvider = normalizeProvider(provider);

    if (
      normalizedProvider === null
      || !supported
      || savingProviders.has(normalizedProvider)
      || typeof savePreference !== 'function'
    ) {
      return;
    }

    const previousEnabled = isProviderEnabled(normalizedProvider);
    setProviderEnabled(normalizedProvider, enabled);
    savingProviders.add(normalizedProvider);
    errorsByProvider.delete(normalizedProvider);
    updateProvider(normalizedProvider);

    try {
      const result = await savePreference({
        enabled: enabled === true,
        provider: normalizedProvider,
      });
      setProviderEnabled(normalizedProvider, result?.enabled === true);
      errorsByProvider.delete(normalizedProvider);
    } catch (error) {
      setProviderEnabled(normalizedProvider, previousEnabled);
      errorsByProvider.set(normalizedProvider, safeBatchProviderSaveError(error));
    } finally {
      savingProviders.delete(normalizedProvider);
      updateProvider(normalizedProvider);
    }
  }

  function replacePreferences(preferences, options = {}) {
    enabledByProvider.clear();

    for (const [provider, enabled] of Object.entries(preferences ?? {})) {
      if (enabled === true) {
        enabledByProvider.set(provider, true);
      }
    }

    if (options.update !== false) {
      updateAll();
    }
  }

  function presentationState(provider) {
    const normalizedProvider = normalizeProvider(provider);

    if (normalizedProvider === null) {
      return null;
    }

    const error = errorsByProvider.get(normalizedProvider);

    return {
      available: true,
      checked: isProviderEnabled(normalizedProvider),
      supported,
      ...(!supported ? { unsupportedMessage } : {}),
      ...(savingProviders.has(normalizedProvider) ? { saving: true } : {}),
      ...(error === undefined ? {} : { error }),
    };
  }

  function updateAll() {
    for (const provider of new Set(
      [...getContextsById().values()].map((context) => context.provider),
    )) {
      updateProvider(provider);
    }
  }

  function updateProvider(provider) {
    for (const [id, context] of getContextsById().entries()) {
      if (context.provider === provider) {
        onBadgeState(id, { batch: presentationState(provider) });
      }
    }
  }

  function bindStorageChanges() {
    if (isBound) {
      return;
    }

    isBound = true;
    onStorageChanged?.addListener?.((changes, areaName) => {
      const capabilities = desktopCapabilitiesFromStorageChange(changes, areaName);

      if (capabilities !== null) {
        const nextSupported = hasDesktopCapability(
          capabilities,
          desktopCapabilities.batchProviderPreference,
        );

        if (nextSupported !== supported) {
          supported = nextSupported;
          updateAll();
        }
      }

      const preferences = batchProviderPreferencesFromStorageChange(changes, areaName);

      if (preferences !== null) {
        replacePreferences(preferences);
      }
    });
  }

  return {
    changeProvider,
    initialize,
    isProviderEnabled,
    presentationState,
    replacePreferences,
    setProviderEnabled,
    updateProvider,
  };
}

export function safeBatchProviderSaveError(error) {
  if (error?.code === 'DESKTOP_OFFLINE') {
    return 'Atlas Desktop is offline. Batch mode was not saved.';
  }
  if (error?.code === 'DESKTOP_TIMEOUT') {
    return 'Atlas Desktop did not respond. Batch mode was not saved.';
  }
  if (['PAIRING_REQUIRED', 'CLIENT_REVOKED', 'INVALID_CLIENT', 'UNAUTHORIZED'].includes(error?.code)) {
    return 'Pair this browser with Atlas Desktop before changing batch mode.';
  }
  if (['DESKTOP_CAPABILITY_REQUIRED', 'PROTOCOL_MISMATCH', 'CHANNEL_MISMATCH'].includes(error?.code)) {
    return 'Update Atlas Desktop and confirm this extension uses the same release channel.';
  }
  if (error?.code === 'POLICY_REVISION_CONFLICT') {
    return 'Batch mode changed before Atlas could save it. Try once more.';
  }
  if (['INVALID_RESPONSE', 'INVALID_RUNTIME_POLICY', 'STALE_RUNTIME_POLICY'].includes(error?.code)) {
    return 'Atlas Desktop returned an invalid settings response. Update both apps and try again.';
  }
  return 'Atlas Desktop could not save batch mode.';
}

function normalizeProvider(value) {
  const provider = typeof value === 'string' ? value.trim() : '';

  return provider === '' ? null : provider;
}
