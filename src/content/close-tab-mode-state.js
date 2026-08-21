import {
  closeTabPreferencesFromStorageChange,
  closeTabModes,
  loadCloseTabModeForSiteDomain,
  normalizeCloseTabMode,
  normalizeSiteDomain,
} from '../shared/close-tab-preferences.js';

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
  let isBound = false;

  async function initialize() {
    bindStorageChanges();

    const siteDomain = currentSiteDomain();

    if (siteDomain === null) {
      return;
    }

    mode = await loadCloseTabModeForSiteDomain(siteDomain, storage);
    onChanged();
  }

  async function setMode(nextMode) {
    const siteDomain = currentSiteDomain();

    if (siteDomain === null || saving || typeof saveMode !== 'function') {
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
  if (error?.code === 'PAIRING_REQUIRED') {
    return 'Pair this browser with Atlas Desktop before changing this setting.';
  }
  if (error?.code === 'POLICY_REVISION_CONFLICT') {
    return 'The setting changed again before Atlas could save it. Try once more.';
  }
  return 'Atlas Desktop could not save the close tab setting.';
}
