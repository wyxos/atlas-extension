import { browserProviders } from '../provider-plugins/registry.js';

// Event routing only. Asset/file identity determines which widget consumes it.
export function canonicalProviderPage(value) {
  for (const provider of browserProviders) {
    const identity = provider.canonicalPage?.(value);
    if (identity) return identity;
  }
  return value;
}

export function shouldPreserveProviderReferrer(value) {
  return browserProviders.some(provider => provider.preserveReferrer?.(value) === true);
}
