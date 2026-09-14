// The browser supplies the top-level URL even for cross-origin/nested frames.
// Keep the frame referrer and matching identity independent of extraction order.
export function withReactionPageContext(message, sender) {
  const topPageUrl = sender?.frameId > 0 ? httpUrl(sender.tab?.url) : null;
  const decorate = (asset) => {
    if (!asset) return asset;
    const original = { ...asset };
    delete original.topPageUrl;
    return original.type === 'video' && topPageUrl
      ? { ...original, topPageUrl }
      : original;
  };
  if (message.type === 'atlas-extension.asset-reaction') {
    return { ...message, asset: decorate(message.asset) };
  }
  if (message.type === 'atlas-extension.asset-reaction-batch') {
    return { ...message, items: (message.items ?? []).map((item) => ({ ...item, asset: decorate(item.asset) })) };
  }
  return message;
}

function httpUrl(value) {
  if (typeof value !== 'string' || value.length > 16384) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}
