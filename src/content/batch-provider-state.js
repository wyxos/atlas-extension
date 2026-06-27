export function createBatchProviderState({
  getContextsById,
  onBadgeState,
} = {}) {
  const enabledByProvider = new Map();

  function isProviderEnabled(provider) {
    return typeof provider === 'string' && enabledByProvider.get(provider) === true;
  }

  function setProviderEnabled(provider, enabled) {
    if (typeof provider !== 'string' || provider.trim() === '') {
      return;
    }

    if (enabled === true) {
      enabledByProvider.set(provider, true);
    } else {
      enabledByProvider.delete(provider);
    }
  }

  function replacePreferences(preferences) {
    enabledByProvider.clear();

    for (const [provider, enabled] of Object.entries(preferences ?? {})) {
      if (enabled === true) {
        enabledByProvider.set(provider, true);
      }
    }

    updateAll();
  }

  function updateAll() {
    for (const provider of new Set([...getContextsById().values()].map((context) => context.provider))) {
      updateProvider(provider);
    }
  }

  function updateProvider(provider) {
    for (const [id, context] of getContextsById().entries()) {
      if (context.provider === provider) {
        onBadgeState(id, {
          batch: {
            available: true,
            checked: isProviderEnabled(provider),
          },
        });
      }
    }
  }

  return {
    isProviderEnabled,
    replacePreferences,
    setProviderEnabled,
    updateProvider,
  };
}
