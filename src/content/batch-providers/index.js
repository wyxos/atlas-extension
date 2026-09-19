import { browserProviders } from '../../provider-plugins/registry.js';
import { collectRedditBatchItems, resolveRedditBatchContext } from './reddit.js';

const providers = new Map([
  ['reddit', { collect: collectRedditBatchItems, resolve: resolveRedditBatchContext }],
  ...browserProviders.filter(provider => provider.batch).map(provider => [provider.id, provider.batch]),
]);

export function resolveAssetBatchContext(options = {}) {
  for (const provider of providers.values()) {
    const context = provider.resolve(options);

    if (context !== null) {
      return context;
    }
  }

  return null;
}

export async function collectAssetBatchItems(context, options = {}) {
  const provider = providers.get(context?.provider);

  if (provider === undefined) {
    return [];
  }

  return provider.collect({ ...options, context });
}
