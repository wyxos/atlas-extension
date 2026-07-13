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
