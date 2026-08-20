import {
  loadOverlayPlacementPreferences,
  normalizeOverlayPlacement,
  overlayPlacementPreferencesFromStorageChange,
  placementForSiteDomain,
} from '../shared/overlay-placement-preferences.js';

const defaultPlacement = { xRatio: 0.5, yRatio: 0.82 };

function siteDomain(href) {
  try {
    return new URL(href).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

export function createWidgetPlacementRuntime({
  getElement,
  getLocationHref,
  refresh,
  reportFailure,
  savePlacement,
}) {
  let preferences = { positionsBySiteDomain: {}, version: 1 };

  function placementForCurrentSite() {
    return placementForSiteDomain(preferences, getLocationHref());
  }

  async function initialize() {
    preferences = await loadOverlayPlacementPreferences();
    refresh();
  }

  function applyStorageChange(changes, areaName) {
    const changed = overlayPlacementPreferencesFromStorageChange(changes, areaName);
    if (changed === null) return;
    preferences = changed;
    refresh();
  }

  async function change(event) {
    const element = getElement(event.id);
    const domain = siteDomain(getLocationHref());
    if (element === undefined || domain === '') return;
    const current = placementForSiteDomain(preferences, domain) ?? defaultPlacement;
    let placement;
    if (Number.isFinite(event.deltaXRatio) || Number.isFinite(event.deltaYRatio)) {
      placement = normalizeOverlayPlacement({
        xRatio: current.xRatio + (Number(event.deltaXRatio) || 0),
        yRatio: current.yRatio + (Number(event.deltaYRatio) || 0),
      });
    } else {
      const rect = element.getBoundingClientRect?.();
      if (!(Number(rect?.width) > 0) || !(Number(rect?.height) > 0)) return;
      placement = normalizeOverlayPlacement({
        xRatio: (Number(event.clientX) - rect.left) / rect.width,
        yRatio: (Number(event.clientY) - rect.top) / rect.height,
      });
    }
    if (placement === null) return;
    preferences = {
      ...preferences,
      positionsBySiteDomain: { ...preferences.positionsBySiteDomain, [domain]: placement },
    };
    refresh();
    if (event.commit !== true) return;
    try {
      await savePlacement({ placement, siteDomain: domain });
    } catch (error) {
      preferences = await loadOverlayPlacementPreferences();
      refresh();
      reportFailure(event.id, error?.message ?? 'Atlas Desktop is unavailable.');
    }
  }

  return { applyStorageChange, change, initialize, placementForCurrentSite };
}
