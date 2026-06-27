export function applyDownloadEvent(payload, {
  markAssetSourceChecked,
  markReferrerUrlChecked,
  updateBadgeStateBySource,
  updateReferrerBadges,
}) {
  const assetUrl = typeof payload?.assetUrl === 'string' ? payload.assetUrl : null;

  if (assetUrl === null) {
    return;
  }

  const nextState = withoutUndefinedValues({
    download: payload.download,
    file: payload.file,
    reaction: payload.reaction,
  });
  const referrerUrl = typeof payload?.referrerUrl === 'string' ? payload.referrerUrl : null;

  markAssetSourceChecked(assetUrl, nextState);
  if (referrerUrl !== null) {
    markReferrerUrlChecked(referrerUrl, nextState);
  }

  updateBadgeStateBySource(assetUrl, nextState);
  updateReferrerBadges(payload);
}

function withoutUndefinedValues(values) {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  );
}
