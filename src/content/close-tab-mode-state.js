import {
  closeTabPreferencesFromStorageChange,
  closeTabModes,
  loadCloseTabModeForSiteDomain,
  normalizeCloseTabMode,
  normalizeSiteDomain,
} from '../shared/close-tab-preferences.js';
import {
  desktopCapabilities,
  desktopCapabilitiesFromStorageChange,
  hasDesktopCapability,
  loadDesktopCapabilities,
} from '../shared/desktop-capabilities.js';

const unsupportedMessage = 'Update Atlas Desktop to change close tab behavior.';

export function createCloseTabModeState({
  getLocationHref = () => globalThis.location?.href,
  onChanged = () => {},
  clearFailure = () => {},
  onStorageChanged = globalThis.chrome?.storage?.onChanged,
  reportFailure = () => {},
  saveMode,
  storage,
} = {}) {
  let mode = closeTabModes.off;
  let saving = false;
  let supported = false;
  let isBound = false;

  async function initialize() {
    bindStorageChanges();

    const siteDomain = currentSiteDomain();

    if (siteDomain === null) {
      return;
    }

    const [savedMode, capabilities] = await Promise.all([
      loadCloseTabModeForSiteDomain(siteDomain, storage),
      loadDesktopCapabilities(storage),
    ]);
    mode = savedMode;
    supported = hasDesktopCapability(capabilities, desktopCapabilities.closeTabMode);
    onChanged();
  }

  async function setMode(nextMode) {
    const siteDomain = currentSiteDomain();

    if (siteDomain === null || !supported || saving || typeof saveMode !== 'function') {
      return;
    }

    const previousMode = mode;
    mode = normalizeCloseTabMode(nextMode);
    saving = true;
    clearFailure();
    onChanged();
    try {
      const result = await saveMode({ mode, siteDomain });
      mode = normalizeCloseTabMode(result?.mode);
    } catch (error) {
      mode = previousMode;
      reportFailure(safeCloseTabSaveError(error));
    } finally {
      saving = false;
      onChanged();
    }
  }

  function presentationState() {
    return currentSiteDomain() === null
      ? null
      : {
        available: true,
        mode,
        supported,
        ...(!supported ? { unsupportedMessage } : {}),
        ...(saving ? { saving: true } : {}),
      };
  }

  async function loadModeForReaction() {
    return mode;
  }

  function bindStorageChanges() {
    if (isBound) {
      return;
    }

    isBound = true;
    onStorageChanged?.addListener?.((changes, areaName) => {
      const capabilities = desktopCapabilitiesFromStorageChange(changes, areaName);

      if (capabilities !== null) {
        const nextSupported = hasDesktopCapability(capabilities, desktopCapabilities.closeTabMode);

        if (nextSupported !== supported) {
          supported = nextSupported;
          onChanged();
        }
      }

      const preferences = closeTabPreferencesFromStorageChange(changes, areaName);

      if (preferences !== null) {
        applyPreferences(preferences);
      }
    });
  }

  function applyPreferences(preferences) {
    const siteDomain = currentSiteDomain();

    if (siteDomain === null) {
      return;
    }

    const nextMode = preferences.modesBySiteDomain[siteDomain] ?? closeTabModes.off;

    if (nextMode !== mode) {
      mode = nextMode;
      onChanged();
    }
  }

  function currentSiteDomain() {
    return normalizeSiteDomain(getLocationHref());
  }

  return {
    initialize,
    loadModeForReaction,
    presentationState,
    setMode,
  };
}

export function safeCloseTabSaveError(error) {
  if (error?.code === 'DESKTOP_OFFLINE') {
    return 'Atlas Desktop is offline. The setting was not saved.';
  }
  if (error?.code === 'DESKTOP_TIMEOUT') {
    return 'Atlas Desktop did not respond. The setting was not saved.';
  }
  if (['PAIRING_REQUIRED', 'CLIENT_REVOKED', 'INVALID_CLIENT', 'UNAUTHORIZED'].includes(error?.code)) {
    return 'Pair this browser with Atlas Desktop before changing this setting.';
  }
  if (['DESKTOP_CAPABILITY_REQUIRED', 'PROTOCOL_MISMATCH', 'CHANNEL_MISMATCH'].includes(error?.code)) {
    return 'Update Atlas Desktop and confirm this extension uses the same release channel.';
  }
  if (error?.code === 'POLICY_REVISION_CONFLICT') {
    return 'The setting changed again before Atlas could save it. Try once more.';
  }
  if (['INVALID_RESPONSE', 'INVALID_RUNTIME_POLICY', 'STALE_RUNTIME_POLICY'].includes(error?.code)) {
    return 'Atlas Desktop returned an invalid settings response. Update both apps and try again.';
  }
  return 'Atlas Desktop could not save the close tab setting.';
}
