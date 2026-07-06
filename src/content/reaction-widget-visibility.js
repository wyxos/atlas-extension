import {
  readReactionWidgetVisibility,
  watchReactionWidgetVisibility,
} from '../shared/reaction-widget-visibility.js';

export async function initializeReactionWidgetVisibility({
  badgeHosts,
  onShown = () => {},
  setOverlayBadgesVisible = () => {},
} = {}) {
  const applyVisibility = (visible) => {
    const isVisible = visible !== false;

    badgeHosts?.setVisible?.(isVisible);
    setOverlayBadgesVisible(isVisible);

    if (isVisible) {
      onShown();
    }
  };

  applyVisibility(await readReactionWidgetVisibility());
  watchReactionWidgetVisibility({
    onChanged: applyVisibility,
  });
}
