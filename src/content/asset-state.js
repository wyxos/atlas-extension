export function stateForSyncedAsset(previousAsset, nextAsset, currentState) {
  if (!previousAsset || previousAsset.source === nextAsset.source) {
    return currentState ?? null;
  }

  return null;
}

export function stateWithoutAtlasAssetStatus(currentState) {
  const nextState = {};

  for (const key of ['batch', 'isBusy', 'isDeleting', 'submittingReaction']) {
    if (currentState?.[key] !== undefined) {
      nextState[key] = currentState[key];
    }
  }

  return nextState;
}

export function shouldApplyAssetResponse(requestAsset, currentAsset) {
  return Boolean(
    requestAsset
      && currentAsset
      && requestAsset.source === currentAsset.source,
  );
}
