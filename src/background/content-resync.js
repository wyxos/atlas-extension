// Keep provider invalidation sticky while a tab cannot receive messages. Only
// acknowledge the generation actually sent; a newer invalidation must survive.
export async function deliverContentResync({ registry, sendMessage, tabId, providerChanged = true }) {
  registry.markNeedsResync(tabId, providerChanged);
  const state = registry.targetState(tabId);
  const token = registry.resyncToken(tabId);
  providerChanged = providerChanged || state?.providerChanged === true;
  if (state?.discarded || state?.frozen || state?.loading) return false;
  try {
    await sendMessage(tabId, { type: 'atlas-extension.desktop.resync-required', providerChanged });
    registry.markResynced(tabId, token);
    return true;
  } catch {
    registry.markNeedsResync(tabId);
    return false;
  }
}
