import {
  loadNextTabsDefaultLimit,
  normalizeLoadNextTabsLimit,
  stepLoadNextTabsLimit,
} from '../shared/load-next-tabs-messages.js';

export const loadNextTabsLimitStorageKey = 'atlasExtensionLoadNextTabsLimit';

export function initializeNextTabsLimit({
  input,
  decrementButton,
  incrementButton,
  onError = () => {},
  storage = globalThis.chrome?.storage?.local,
}) {
  let edited = false;

  function display(limit) {
    if (input) input.value = String(limit);
    return limit;
  }

  async function persist(limit) {
    try {
      if (typeof storage?.set !== 'function') {
        throw new Error('Extension storage is unavailable.');
      }
      await storage.set({ [loadNextTabsLimitStorageKey]: limit });
    } catch {
      onError('The tab count could not be saved.');
    }
  }

  function save(limit) {
    edited = true;
    void persist(limit);
    return limit;
  }

  function normalize() {
    return save(display(normalizeLoadNextTabsLimit(input?.value)));
  }

  decrementButton?.addEventListener('click', () => {
    save(display(stepLoadNextTabsLimit(input?.value, -1)));
  });
  incrementButton?.addEventListener('click', () => {
    save(display(stepLoadNextTabsLimit(input?.value, 1)));
  });
  input?.addEventListener('blur', normalize);
  input?.addEventListener('input', () => {
    edited = true;
    if (input.value.trim() !== '' && Number.isInteger(Number(input.value))) {
      save(normalizeLoadNextTabsLimit(input.value));
    }
  });

  display(loadNextTabsDefaultLimit);
  const ready = (async () => {
    try {
      const values = await storage?.get(loadNextTabsLimitStorageKey);
      if (!edited) display(normalizeLoadNextTabsLimit(values?.[loadNextTabsLimitStorageKey]));
    } catch {
      onError('The saved tab count could not be read.');
    }
  })();

  return { normalize, ready };
}
