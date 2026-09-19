export function canonicalCivitaiPage(value) {
  return civitaiPage(value) ?? value;
}

export function civitaiPage(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.port || url.username || url.password) return null;
    if (!['civitai.com', 'civitai.red', 'www.civitai.com', 'www.civitai.red'].includes(url.hostname)) return null;
    const match = /^\/images\/([1-9]\d*)\/?$/.exec(url.pathname);
    return match ? `https://civitai.com/images/${match[1]}` : null;
  } catch { return null; }
}
