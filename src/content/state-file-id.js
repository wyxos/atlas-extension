export function resolveStateFileId(state) {
  const id = Number(state?.file?.id ?? state?.download?.file_id ?? state?.download?.fileId);

  return Number.isInteger(id) && id > 0 ? id : null;
}
