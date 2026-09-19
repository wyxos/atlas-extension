export function deviantArtPage(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.port || url.username || url.password
      || !['deviantart.com', 'www.deviantart.com'].includes(url.hostname)) return null;
    const match = /^\/[^/]+\/art\/(?:[^/]*-)?([1-9]\d*)\/?$/.exec(url.pathname);
    return match ? `deviantart:${match[1]}` : null;
  } catch { return null; }
}
