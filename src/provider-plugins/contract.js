// Site adapters are compiled with the extension and receive browser context only.
// Shared capture, transfer, status, reactions and credentials remain host-owned.
export function createBrowserProviderRegistry(providers) {
  const ids = new Set();
  for (const provider of providers) {
    if (!provider || !/^[a-z][a-z0-9-]{0,63}$/.test(provider.id) || ids.has(provider.id)) {
      throw new Error('Invalid or duplicate browser provider.');
    }
    ids.add(provider.id);
    for (const key of ['canonicalPage', 'captureIdentity', 'preserveReferrer']) {
      if (provider[key] !== undefined && typeof provider[key] !== 'function') {
        throw new Error('Invalid browser provider capability.');
      }
    }
    if (provider.batch && (typeof provider.batch.collect !== 'function' || typeof provider.batch.resolve !== 'function')) {
      throw new Error('Invalid browser batch provider.');
    }
  }
  return Object.freeze([...providers]);
}
