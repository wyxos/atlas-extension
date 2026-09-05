export function mergeReferrerCounts(target, referrerUrls, counts) {
  for (const referrerUrl of referrerUrls) {
    const count = Number(counts?.[referrerUrl] ?? 0);
    if (Number.isFinite(count) && count > 0) target[referrerUrl] = Math.floor(count);
    else delete target[referrerUrl];
  }
}
