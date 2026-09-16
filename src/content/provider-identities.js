import { browserProviders } from '../provider-plugins/registry.js';

// Hints remain untrusted; Desktop validates identity and the selected asset.
export function captureProviderIdentity({ documentContext = globalThis.document, pageUrl } = {}) {
  for (const provider of browserProviders) {
    const identity = provider.captureIdentity?.(documentContext, pageUrl);
    if (identity) return identity;
  }
  return null;
}
