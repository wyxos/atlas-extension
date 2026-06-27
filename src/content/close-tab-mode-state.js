import {
  closeTabPreferencesFromStorageChange,
  closeTabModes,
  loadCloseTabModeForSiteDomain,
  normalizeSiteDomain,
  saveCloseTabModeForSiteDomain,
} from '../shared/close-tab-preferences.js';

export function createCloseTabModeState({
  getLocationHref = () => globalThis.location?.href,
  onChanged = () => {},
  onStorageChanged = globalThis.chrome?.storage?.onChanged,
  storage,
} = {}) {
  let mode = closeTabModes.off;
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

    if (siteDomain === null) {
      return;
    }

    mode = nextMode;
    onChanged();
    await saveCloseTabModeForSiteDomain(siteDomain, nextMode, storage);
  }

  function presentationState() {
    return currentSiteDomain() === null
      ? null
      : {
        available: true,
        mode,
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
