import { readPageMetadata } from '../browser-page-context.js';
import { resolveBrowserPagesViaBackground } from '../background-api.js';
import { browserPageContext } from '../browser-page-context.js';
import { createThumbnailGallery } from '../gallery/thumbnails.js';
import { createSlotGallery } from '../gallery/slots.js';
function adapter(profile) {
  if (profile?.gallery?.kind === 'thumbnails') return createThumbnailGallery(profile);
  if (profile?.gallery?.kind === 'slots') return createSlotGallery(profile);
  return null;
}
export function resolveAssetBatchContext(options = {}) {
  const profile = options.pageContext ?? browserPageContext.get(options.locationContext?.href ?? globalThis.location?.href);
  let context;
  try { context = adapter(profile)?.resolve(options); } catch { return null; }
  return context ? { ...context, profile, managed: options.pageContext === undefined, epoch: browserPageContext.token() } : null;
}
export async function collectAssetBatchItems(context, options = {}) {
  const collector = adapter(context?.profile);
  if (!collector) throw new Error('This gallery provider is unavailable. Refresh the page and retry.');
  const assertActive = () => {
    if (context.managed && context.epoch !== browserPageContext.token()) throw new Error('The browser provider changed. Refresh the page and retry.');
  };
  assertActive();
  async function validateCurrentProfile() {
    if (!context.managed) return;
    const url = options.locationContext?.href ?? globalThis.location?.href;
    const result = await resolveBrowserPagesViaBackground({ pages: [{ url, metadata: readPageMetadata(options.documentContext ?? globalThis.document) }] });
    const fresh = result?.pages?.[0];
    assertActive();
    if (result?.pages?.length !== 1 || fresh?.url !== url || fresh?.provider !== context.profile.provider
      || !fresh.gallery || fresh.profileVersion !== context.profile.profileVersion
      || JSON.stringify(fresh.identity ?? null) !== JSON.stringify(context.profile.identity ?? null)
      || fresh.galleryKey !== context.profile.galleryKey
      || JSON.stringify(fresh.gallery) !== JSON.stringify(context.profile.gallery)) {
      throw new Error('The browser provider changed. Refresh the page and retry.');
    }
  }
  await validateCurrentProfile();
  const items = await collector.collect({ ...options, context, assertActive });
  assertActive();
  await validateCurrentProfile();
  return items;
}
