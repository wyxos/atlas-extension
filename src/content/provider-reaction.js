export async function submitWithProviderFallback({ submit, confirmFallback, onFailure = () => {}, isCurrent = () => true }) {
  try {
    return await submit(false);
  } catch (error) {
    onFailure(error);
    if (error?.code !== 'PROVIDER_RESOLUTION_FAILED' || !isCurrent()) throw error;
    const choice = await confirmFallback({ kind: 'provider-fallback' });
    if (choice !== 'browser-download' || !isCurrent()) return null;
    return submit(true);
  }
}

export function matchesReactionFile(source, asset, currentState, nextState) {
  return asset.source === source || (Number.isSafeInteger(nextState?.file?.id)
    && nextState.file.id === currentState?.file?.id);
}
