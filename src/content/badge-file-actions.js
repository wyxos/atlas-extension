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
}) {
  function handleOpenFile(event) {
    const fileId = resolveFileId(badgeStatesById.get(event.id));
    if (fileId !== null) {
      void openFile({ fileId });
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
      if (!shouldApplyResponse(asset, assetsById.get(event.id))) {
        return;
      }

      updateBadgeState(event.id, { isDeleting: false });
    }
  }

  return { handleDelete, handleOpenFile };
}
