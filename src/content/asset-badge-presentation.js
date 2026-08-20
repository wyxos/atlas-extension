import { placeVisibleAssetBadge } from './asset-badge-placement.js';
import { createBadgePresentation } from './badge-model.js';

export function createAssetBadgePresentation({
  asset,
  badgeHosts,
  closeTab,
  element,
  id,
  placement,
  state,
  viewportPadding,
  visibleRect,
}) {
  const resolvedPlacement = placeVisibleAssetBadge({
    asset,
    badgeHosts,
    element,
    id,
    placement,
    viewportPadding,
    visibleRect,
  }) ?? {};

  return createBadgePresentation(asset, visibleRect, viewportPadding, {
    ...(state ?? {}),
    closeTab,
  }, resolvedPlacement);
}
