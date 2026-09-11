import { submitReaction } from '../../src/content/provider-reaction.js';

const host = document.querySelector('#host-modal');
document.querySelector('#host-open').onclick = () => host.showModal();
document.querySelector('#host-close').onclick = () => host.close();
document.querySelector('#react').onclick = async () => {
  try {
    await submitReaction({ submit: async () => { throw Object.assign(new Error('Provider unavailable'), { code: 'PROVIDER_RESOLUTION_FAILED' }); } });
  } catch {
    document.querySelector('#result').textContent = 'Request failed without a metadata prompt';
  }
};
