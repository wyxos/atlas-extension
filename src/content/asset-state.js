export function stateForSyncedAsset(previousAsset, nextAsset, currentState) {
  if (!previousAsset || previousAsset.source === nextAsset.source) {
    return currentState ?? null;
  }

  return null;
}

export function shouldApplyAssetResponse(requestAsset, currentAsset) {
  return Boolean(
    requestAsset
      && currentAsset
      && requestAsset.source === currentAsset.source,
  );
}
