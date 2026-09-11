export async function submitReaction({ submit, onFailure = () => {} }) {
  try {
    return await submit(false);
  } catch (error) {
    onFailure(error);
    throw error;
  }
}

export function matchesReactionFile(source, asset, currentState, nextState) {
  return asset.source === source || (Number.isSafeInteger(nextState?.file?.id)
    && nextState.file.id === currentState?.file?.id);
}
