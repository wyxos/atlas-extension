import { postAssetOrBatchReaction } from './batch-reactions.js';

export function createReactionInspector({ assetsById, batchContextsById, badgeStatesById, runtime,
  documentContext, locationContext, submit = postAssetOrBatchReaction }) {
  return ({ id, type, downloadAction, useBrowserDownload }) => {
    const asset = assetsById.get(id);
    if (!asset) return Promise.reject(new Error('This asset is no longer available.'));
    const batchContext = batchContextsById.get(id);
    const currentState = badgeStatesById.get(id) ?? {};
    const key = JSON.stringify([id, type, downloadAction, useBrowserDownload, currentState.batch?.checked,
      currentState.batch?.checked ? [batchContext?.provider, batchContext?.profile?.profileVersion,
        batchContext?.profile?.galleryKey, batchContext?.profile?.identity, batchContext?.epoch] : asset.source]);
    return runtime.inspect(key, (onOperation) => submit({
      asset, batchContext, currentState, documentContext, downloadAction, event: { type },
      locationContext, previewOnly: true, useBrowserDownload, onOperation,
    }), id);
  };
}
