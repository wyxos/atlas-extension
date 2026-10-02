import { createGalleryReactionOperation } from './gallery-reaction-operation.js';
import { captureProviderIdentity } from './provider-identities.js';
import {
  acknowledgeGallerySegmentViaBackground,
  postAssetReactionViaBackground,
} from './background-api.js';

export function stateWithBatchContext(state, batchContext, providerState = false) {
  const rest = { ...(state ?? {}) };

  delete rest.batch;

  if (batchContext === null) {
    return Object.keys(rest).length > 0 ? rest : null;
  }

  return {
    ...rest,
    batch: providerState && typeof providerState === 'object'
      ? providerState
      : {
        available: true,
        checked: providerState === true,
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
  previewOnly,
  useBrowserDownload,
  onProgress,
  onAccepted,
  onOperation,
}) {
  if (currentState.batch?.checked === true && batchContext != null) {
    const operation = createGalleryReactionOperation({ asset, batchContext, documentContext, locationContext,
      downloadAction, event, previewOnly, useBrowserDownload }, {
      acknowledge: previewOnly === true ? undefined : acknowledgeGallerySegmentViaBackground,
    });
    onOperation?.(operation);
    return operation.run({ onProgress, onAccepted });
  }

  return postAssetReactionViaBackground({
    asset: { ...asset, providerIdentity: captureProviderIdentity({ documentContext, pageUrl: locationContext.href }) ?? undefined },
    downloadAction,
    reactionType: event.type,
    ...(previewOnly === true ? { previewOnly: true } : {}),
    ...(useBrowserDownload === true ? { useBrowserDownload: true } : {}),
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

    markAssetSourceChecked(source, item);
    updateBadgeStateBySource(source, item);
  }
}
