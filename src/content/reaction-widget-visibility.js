import {
  readReactionWidgetVisibility,
  watchReactionWidgetVisibility,
} from '../shared/reaction-widget-visibility.js';

export async function initializeReactionWidgetVisibility({
  badgeHosts,
  getOverlayHost = () => null,
  onShown = () => {},
} = {}) {
  const applyVisibility = (visible) => {
    const isVisible = visible !== false;
    const overlayHost = getOverlayHost();

    badgeHosts?.setVisible?.(isVisible);

    if (overlayHost !== null) {
      overlayHost.style.display = isVisible ? 'block' : 'none';
    }

    if (isVisible) {
      onShown();
    }
  };

  applyVisibility(await readReactionWidgetVisibility());
  watchReactionWidgetVisibility({
    onChanged: applyVisibility,
  });
}
