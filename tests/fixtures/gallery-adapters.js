import { createThumbnailGallery } from '../../src/content/gallery/thumbnails.js';
import { createSlotGallery } from '../../src/content/gallery/slots.js';

// Sample Desktop responses. Native integration tests verify the real package
// descriptors; these fixtures exercise browser mechanics against unchanged DOMs.
export const thumbnailSpec = {
 kind: 'thumbnails', imageSelector: 'img', navigationSelector: 'button, [role="button"]',
 previousLabel: 'Previous', nextLabel: 'Next', indexParameter: 'file', sourceMode: 'src',
 thumbnailSelector: 'section img', thumbnailButtonSelector: 'button,[role="button"]',
 thumbnailContainerSelector: 'section', thumbnailContainerText: 'all images',
};
export const slotSpec = {
 kind: 'slots', rootSelector: 'gallery-carousel', rootIdentityAttribute: 'post-id', rootIdentityPrefix: 't3_',
 assetAncestor: 'figure', slotSelector: 'li[slot]', slotAttribute: 'slot', slotPrefix: 'page-',
 imageSelector: 'figure img', unsupportedSelector: 'video, audio, shreddit-player',
 positionSelector: 'faceplate-carousel', positionAttribute: 'current-aria-live-msg',
 navigationSelector: 'button', previousLabel: 'Previous page', nextLabel: 'Next page',
 indexParameter: 'img_index', clearQuery: true, sourceMode: 'srcset-highest', mediaHosts: ['i.redd.it', 'preview.redd.it'],
};
export function thumbnailProfile(url) { return { provider: 'deviantart', url, identity: null, gallery: thumbnailSpec }; }
export function slotProfile(url) { return { provider: 'reddit', url, galleryKey: new URL(url).pathname.match(/(?:comments|gallery)\/([^/]+)/)?.[1], gallery: slotSpec }; }
const thumbnail = options => createThumbnailGallery(thumbnailProfile(options.locationContext?.href));
export const collectDeviantArtBatchItems = options => thumbnail(options).collect(options);
export const readCurrentDeviantArtBatchItem = options => thumbnail(options).readCurrent(options);
export const deviantArtReferrerForFileIndex = (url, index) => createThumbnailGallery(thumbnailProfile(url)).referrer(url, index);
export const resolveDeviantArtBatchContext = options => new URL(options.locationContext.href).hostname.endsWith('deviantart.com') && !new URL(options.locationContext.href).hostname.startsWith('evil-') ? thumbnail(options).resolve(options) : null;
export const resolveRedditBatchContext = options => {
 const url = options.locationContext?.href;
 if (!url || !(new URL(url).hostname === 'reddit.com' || new URL(url).hostname.endsWith('.reddit.com'))) return null;
 return createSlotGallery(slotProfile(url)).resolve(options);
};
export const collectRedditBatchItems = options => createSlotGallery(slotProfile(options.locationContext.href)).collect(options);

