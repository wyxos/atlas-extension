import { createAssetOverlay } from '../../src/content/overlay-controller.js';
import { createOverlayRoot } from '../../src/content/overlay-host.js';
import { submitWithProviderFallback } from '../../src/content/provider-reaction.js';

const overlay = createAssetOverlay(createOverlayRoot(document, 'fixture-overlay'));
const host = document.querySelector('#host-modal');
document.querySelector('#host-open').onclick = () => host.showModal();
document.querySelector('#host-close').onclick = () => host.close();
document.querySelector('#react').onclick = async () => {
  const payload = await submitWithProviderFallback({
    submit: async (fallback) => {
      if (!fallback) throw Object.assign(new Error('Provider unavailable'), { code: 'PROVIDER_RESOLUTION_FAILED' });
      return { accepted: true };
    },
    confirmFallback: (request) => overlay.confirmReactionUpdate(request),
  });
  document.querySelector('#result').textContent = payload ? 'Fallback accepted' : 'Canceled';
};
