import { normalizeSiteDomain } from './close-tab-preferences.js';

export const overlayPlacementPreferencesKey = 'atlasExtensionOverlayPlacementPreferences';

const overlayPlacementPreferencesVersion = 1;

export async function loadOverlayPlacementPreferences(storage = globalThis.chrome?.storage?.local) {
  if (typeof storage?.get !== 'function') {
    return defaultPreferences();
  }

  try {
    const result = await storage.get(overlayPlacementPreferencesKey);
    return normalizeOverlayPlacementPreferences(result?.[overlayPlacementPreferencesKey]);
  } catch {
    return defaultPreferences();
  }
}

export function normalizeOverlayPlacementPreferences(value) {
  const rawPositions = value?.positionsBySiteDomain && typeof value.positionsBySiteDomain === 'object'
    ? value.positionsBySiteDomain
    : {};
  const positionsBySiteDomain = {};

  for (const [domain, placement] of Object.entries(rawPositions)) {
    const normalizedDomain = normalizeSiteDomain(domain);
    const normalizedPlacement = normalizeOverlayPlacement(placement);

    if (normalizedDomain !== null && normalizedPlacement !== null) {
      positionsBySiteDomain[normalizedDomain] = normalizedPlacement;
    }
  }

  return {
    positionsBySiteDomain,
    version: overlayPlacementPreferencesVersion,
  };
}

export function normalizeOverlayPlacement(value) {
  const xRatio = Number(value?.xRatio ?? value?.x_ratio);
  const yRatio = Number(value?.yRatio ?? value?.y_ratio);

  if (!Number.isFinite(xRatio) || !Number.isFinite(yRatio)) {
    return null;
  }

  return {
    xRatio: clampRatio(xRatio),
    yRatio: clampRatio(yRatio),
  };
}

export function placementForSiteDomain(preferences, siteDomain) {
  const domain = normalizeSiteDomain(siteDomain);
  return domain === null
    ? null
    : normalizeOverlayPlacementPreferences(preferences).positionsBySiteDomain[domain] ?? null;
}

export function overlayPlacementPreferencesFromStorageChange(changes, areaName) {
  if (areaName !== 'local' || !(overlayPlacementPreferencesKey in (changes ?? {}))) {
    return null;
  }

  return normalizeOverlayPlacementPreferences(changes[overlayPlacementPreferencesKey]?.newValue);
}

function clampRatio(value) {
  return Math.min(1, Math.max(0, value));
}

function defaultPreferences() {
  return {
    positionsBySiteDomain: {},
    version: overlayPlacementPreferencesVersion,
  };
}
