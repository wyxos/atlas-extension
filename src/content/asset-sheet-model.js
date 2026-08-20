export function listReactionSheetAssets(badges) {
  const sources = new Set();

  return badges.filter((badge) => {
    if (badge.variant === 'referrer' || sources.has(badge.source)) {
      return false;
    }

    sources.add(badge.source);

    return true;
  });
}

export function assetSourceLabel(source) {
  try {
    const url = new URL(source);
    const fileName = url.pathname.split('/').filter(Boolean).pop();
    const path = fileName ? `/${fileName}` : '';

    return `${url.hostname}${path}${url.search}${url.hash}`;
  } catch {
    return source;
  }
}
