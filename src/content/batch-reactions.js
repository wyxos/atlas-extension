import { collectAssetBatchItems } from './batch-providers/index.js';
import {
  postAssetReactionBatchViaBackground,
  postAssetReactionViaBackground,
} from './background-api.js';

export function stateWithBatchContext(state, batchContext, isProviderEnabled = false) {
  const rest = { ...(state ?? {}) };

  delete rest.batch;

  if (batchContext === null) {
    return Object.keys(rest).length > 0 ? rest : null;
  }

  return {
    ...rest,
    batch: {
      available: true,
      checked: isProviderEnabled === true,
    },
  };
}

export async function postAssetOrBatchReaction({
  asset,
  batchContext,
  currentState,
  documentContext,
  downloadAction,
  event,
  locationContext,
}) {
  if (currentState.batch?.checked === true && batchContext !== undefined) {
    const items = await collectAssetBatchItems(batchContext, {
      documentContext,
      locationContext,
    });

    if (items.length > 0) {
      return postAssetReactionBatchViaBackground({
        downloadAction,
        items,
        reactionType: event.type,
      });
    }
  }

  return postAssetReactionViaBackground({
    asset,
    downloadAction,
    reactionType: event.type,
    referrerUrl: locationContext.href,
    source: locationContext.hostname,
  });
}

export function applyBatchReactionPayload(payload, {
  markAssetSourceChecked,
  updateBadgeStateBySource,
}) {
  for (const item of payload.items ?? []) {
    const source = typeof item.asset_url === 'string' ? item.asset_url : null;

    if (source === null) {
      continue;
    }

    markAssetSourceChecked(source);
    updateBadgeStateBySource(source, item);
  }
}
