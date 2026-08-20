export async function fanoutTabMessage({
  clock = () => globalThis.performance?.now?.() ?? Date.now(),
  message,
  metricDetails = {},
  onMetric = () => {},
  sendMessage,
  tabIds,
} = {}) {
  const targets = uniqueTabIds(tabIds);
  const startedAt = clock();
  const deliveredTabIds = [];
  const failedTabIds = [];

  await Promise.all(targets.map(async (tabId) => {
    const messageStartedAt = clock();
    try {
      await sendMessage(tabId, message);
      deliveredTabIds.push(tabId);
    } catch {
      failedTabIds.push(tabId);
    } finally {
      onMetric({
        details: { messageType: message?.type ?? 'unknown', tabId },
        durationMs: Math.max(0, clock() - messageStartedAt),
        name: 'message-latency',
        recordedAt: Date.now(),
      });
    }
  }));

  onMetric({
    details: {
      ...metricDetails,
      delivered: deliveredTabIds.length,
      failed: failedTabIds.length,
      targetedTabs: targets.length,
    },
    durationMs: Math.max(0, clock() - startedAt),
    name: 'fanout-duration',
    recordedAt: Date.now(),
  });

  return { deliveredTabIds, failedTabIds };
}

function uniqueTabIds(tabIds) {
  return [...new Set((Array.isArray(tabIds) ? tabIds : [])
    .map((tabId) => Number(tabId))
    .filter((tabId) => Number.isInteger(tabId) && tabId >= 0))];
}
