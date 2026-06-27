export function upsertBadgeEntry(badges, id, badge) {
  const nextBadge = { id, ...badge };
  const existingIndex = badges.findIndex((entry) => entry.id === id);

  if (existingIndex >= 0) {
    badges.splice(existingIndex, 1, nextBadge);

    return;
  }

  badges.push(nextBadge);
}
