export async function resolveDownloadActionForReaction({
  asset,
  confirmReactionUpdate,
  currentState,
  event,
}) {
  const currentReaction = resolveCurrentReaction(currentState);

  if (currentReaction === null) {
    return undefined;
  }

  const choice = await confirmReactionUpdate({
    assetUrl: asset.source,
    currentReaction,
    nextReaction: event.type,
  });

  if (choice === 'update-only') {
    return 'skip';
  }

  if (choice === 'redownload') {
    return 'force';
  }

  return null;
}

export function resolveCurrentReaction(state) {
  if (state.blacklisted_at || state.blacklistedAt) {
    return 'blacklist';
  }

  if (typeof state.reaction === 'string') {
    return state.reaction;
  }

  if (typeof state.reaction?.type === 'string') {
    return state.reaction.type;
  }

  return null;
}
