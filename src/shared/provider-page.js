import { civitaiPage } from './civitai-page.js';

const pageIdentities = [civitaiPage, deviantArtPage];

// This key only routes events to interested tabs. Asset/file identity still
// decides which widget may consume the event, including on multi-image pages.
export function canonicalProviderPage(value) {
  for (const identify of pageIdentities) {
    const identity = identify(value);
    if (identity) return identity;
  }
  return value;
}

function deviantArtPage(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.port || url.username || url.password
      || !['deviantart.com', 'www.deviantart.com'].includes(url.hostname)) return null;
    const match = /^\/[^/]+\/art\/(?:[^/]*-)?([1-9]\d*)\/?$/.exec(url.pathname);
    return match ? `deviantart:${match[1]}` : null;
  } catch { return null; }
}
