import {
  readReactionWidgetVisibility,
  watchReactionWidgetVisibility,
} from '../shared/reaction-widget-visibility.js';

export async function initializeReactionWidgetVisibility({
  badgeHosts,
  setOverlayBadgesVisible = () => {},
} = {}) {
  const applyVisibility = (visible) => {
    const isVisible = visible !== false;

    badgeHosts?.setVisible?.(isVisible);
    setOverlayBadgesVisible(isVisible);
  };

  applyVisibility(await readReactionWidgetVisibility());
  watchReactionWidgetVisibility({
    onChanged: applyVisibility,
  });
}
