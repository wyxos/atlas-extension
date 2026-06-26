import {
  collectDeviantArtBatchItems,
  resolveDeviantArtBatchContext,
} from './deviantart.js';

const providers = new Map([
  ['deviantart', {
    collect: collectDeviantArtBatchItems,
    resolve: resolveDeviantArtBatchContext,
  }],
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

  return provider.collect(options);
}
