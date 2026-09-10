export function createBadgeFileActions({
  assetsById,
  badgeStatesById,
  deleteFile,
  forgetAssetSource,
  openFile,
  replaceBadgeState,
  resolveFileId,
  shouldApplyResponse,
  updateBadgeState,
  reportFailure = () => {},
}) {
  async function handleOpenFile(event) {
    const fileId = resolveFileId(badgeStatesById.get(event.id));
    if (fileId !== null) {
      try {
        await openFile({ fileId });
        if (badgeStatesById.get(event.id)?.fileActionError) updateBadgeState(event.id, { fileActionError: null });
      } catch {
        const message = 'Could not open this file in Atlas Desktop. Try again.';
        updateBadgeState(event.id, { fileActionError: message });
        reportFailure(message);
      }
    }
  }

  async function handleDelete(event) {
    const asset = assetsById.get(event.id);
    const currentState = badgeStatesById.get(event.id) ?? {};
    const fileId = resolveFileId(currentState);

    if (asset === undefined || fileId === null) {
      return;
    }

    updateBadgeState(event.id, { isDeleting: true });

    try {
      await deleteFile({ fileId });
      forgetAssetSource(asset.source);
      if (!shouldApplyResponse(asset, assetsById.get(event.id))) {
        return;
      }

      replaceBadgeState(event.id, {});
    } catch {
      const message = 'Could not delete this file. Check Atlas Desktop and try again.';
      reportFailure(message);
      if (!shouldApplyResponse(asset, assetsById.get(event.id))) {
        return;
      }

      updateBadgeState(event.id, { isDeleting: false, fileActionError: message });
    }
  }

  return { handleDelete, handleOpenFile };
}
