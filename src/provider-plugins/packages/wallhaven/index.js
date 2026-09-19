// Wallhaven uses Atlas's shared asset capture; this only canonicalizes page events.
export function wallhavenPage(value) {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.port || url.username || url.password
      || !['wallhaven.cc', 'www.wallhaven.cc'].includes(url.hostname)) return null;
    const match = /^\/w\/([a-z0-9]{6})\/?$/.exec(url.pathname);
    return match ? `https://wallhaven.cc/w/${match[1]}` : null;
  } catch { return null; }
}
export default Object.freeze({ id: 'wallhaven', canonicalPage: wallhavenPage });
