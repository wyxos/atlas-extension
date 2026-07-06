export const loadNextTabsDefaultLimit = 10;
export const loadNextTabsMinLimit = 1;
export const loadNextTabsMaxLimit = 99;
export const loadNextTabsRequestType = 'atlas-extension.load-next-tabs';

export function normalizeLoadNextTabsLimit(value, {
  fallback = loadNextTabsDefaultLimit,
} = {}) {
  if (typeof value === 'string' && value.trim() === '') {
    return clampLimit(fallback) ?? loadNextTabsDefaultLimit;
  }

  return clampLimit(value) ?? clampLimit(fallback) ?? loadNextTabsDefaultLimit;
}

export function stepLoadNextTabsLimit(value, delta) {
  const current = normalizeLoadNextTabsLimit(value);
  const step = Number(delta);

  return normalizeLoadNextTabsLimit(current + (Number.isFinite(step) ? step : 0));
}

function clampLimit(value) {
  const number = Number(value);

  if (!Number.isInteger(number)) {
    return null;
  }

  return Math.max(loadNextTabsMinLimit, Math.min(number, loadNextTabsMaxLimit));
}
