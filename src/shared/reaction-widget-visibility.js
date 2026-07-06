export const reactionWidgetVisibilityStorageKey = 'atlasReactionWidgetVisible';

export function normalizeReactionWidgetVisibility(value) {
  return value !== false;
}

export async function readReactionWidgetVisibility({
  storageArea = globalThis.chrome?.storage?.local,
} = {}) {
  const values = await readStorageValue(storageArea, reactionWidgetVisibilityStorageKey);

  return normalizeReactionWidgetVisibility(values?.[reactionWidgetVisibilityStorageKey]);
}

export async function writeReactionWidgetVisibility(visible, {
  storageArea = globalThis.chrome?.storage?.local,
} = {}) {
  const nextVisible = normalizeReactionWidgetVisibility(visible);

  await setStorageValues(storageArea, {
    [reactionWidgetVisibilityStorageKey]: nextVisible,
  });

  return nextVisible;
}

export async function toggleReactionWidgetVisibility(options = {}) {
  const currentVisible = await readReactionWidgetVisibility(options);

  return writeReactionWidgetVisibility(!currentVisible, options);
}

export function watchReactionWidgetVisibility({
  onChanged,
  storageOnChanged = globalThis.chrome?.storage?.onChanged,
} = {}) {
  if (typeof onChanged !== 'function' || typeof storageOnChanged?.addListener !== 'function') {
    return () => {};
  }

  const listener = (changes, areaName) => {
    const nextVisible = reactionWidgetVisibilityFromChanges(changes, areaName);

    if (nextVisible !== null) {
      onChanged(nextVisible);
    }
  };

  storageOnChanged.addListener(listener);

  return () => {
    storageOnChanged.removeListener?.(listener);
  };
}

export function reactionWidgetVisibilityFromChanges(changes, areaName) {
  if (areaName !== 'local' || !Object.hasOwn(changes ?? {}, reactionWidgetVisibilityStorageKey)) {
    return null;
  }

  return normalizeReactionWidgetVisibility(changes[reactionWidgetVisibilityStorageKey]?.newValue);
}

function readStorageValue(storageArea, key) {
  if (typeof storageArea?.get !== 'function') {
    return Promise.resolve({});
  }

  return new Promise((resolve) => {
    try {
      const result = storageArea.get(key, (values) => {
        resolve(values ?? {});
      });

      if (typeof result?.then === 'function') {
        result.then((values) => resolve(values ?? {}), () => resolve({}));
      }
    } catch {
      resolve({});
    }
  });
}

function setStorageValues(storageArea, values) {
  if (typeof storageArea?.set !== 'function') {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    try {
      const result = storageArea.set(values, resolve);

      if (typeof result?.then === 'function') {
        result.then(resolve, resolve);
      }
    } catch {
      resolve();
    }
  });
}
