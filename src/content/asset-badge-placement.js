export function placeVisibleAssetBadge({
  asset,
  badgeHosts,
  element,
  id,
  variant = 'asset',
  viewportPadding,
  visibleRect,
}) {
  if (visibleRect === null) {
    badgeHosts.remove(id);

    return {};
  }

  return badgeHosts.placeBadge(id, element, asset, {
    variant,
    viewportPadding,
  }) ?? {};
}
