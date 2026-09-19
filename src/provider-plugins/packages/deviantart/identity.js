export function deviantArtIdentity(documentContext, pageUrl) {
  let url;
  try { url = new URL(pageUrl); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol) || url.port || url.username || url.password
    || !['deviantart.com', 'www.deviantart.com'].includes(url.hostname)
    || !/^\/[^/]+\/art\/[^/]*\d+\/?$/.test(url.pathname)) return null;
  const value = documentContext?.querySelector?.('meta[property="da:appurl"], meta[name="da:appurl"]')?.getAttribute?.('content');
  const match = /^DeviantArt:\/\/deviation\/([\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})$/i.exec(value ?? '');
  return match ? { provider: 'deviantart', item_id: match[1].toLowerCase() } : null;
}
