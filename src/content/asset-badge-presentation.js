import { placeVisibleAssetBadge } from './asset-badge-placement.js';
import { createBadgePresentation } from './badge-model.js';

export function createAssetBadgePresentation({
  asset,
  badgeHosts,
  closeTab,
  element,
  id,
  state,
  viewportPadding,
  visibleRect,
}) {
  const placement = placeVisibleAssetBadge({
    asset,
    badgeHosts,
    element,
    id,
    viewportPadding,
    visibleRect,
  }) ?? {};

  return createBadgePresentation(asset, visibleRect, viewportPadding, {
    ...(state ?? {}),
    closeTab,
  }, placement);
}
