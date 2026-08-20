export function createEventProbeRunner({
  clearTimeoutFn = globalThis.clearTimeout,
  queryActiveTab,
  randomId = () => globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  requestContext,
  sendToTab,
  setTimeoutFn = globalThis.setTimeout,
  timeoutMs = 5000,
}) {
  const pending = new Map();

  function receive(payload) {
    const probe = pending.get(payload?.probeId);
    if (probe === undefined) return false;
    pending.delete(payload.probeId);
    clearTimeoutFn(probe.timeoutId);
    probe.resolve(payload);
    return true;
  }

  async function testActiveTab() {
    const tab = await queryActiveTab();
    if (!Number.isInteger(tab?.id)) {
      throw new Error('No active browser tab is available.');
    }

    const probeId = randomId();
    let timeoutId;
    const backgroundReceipt = new Promise((resolve, reject) => {
      timeoutId = setTimeoutFn(() => {
        pending.delete(probeId);
        reject(new Error(`Desktop emitted no probe event within ${timeoutMs / 1000} seconds.`));
      }, timeoutMs);
      pending.set(probeId, { resolve, timeoutId });
    });

    try {
      const { credentials, transport } = await requestContext();
      const accepted = await transport.diagnosticProbe(credentials, probeId);
      const received = await backgroundReceipt;
      const content = await sendToTab(tab.id, {
        probeId,
        type: 'atlas-extension.diagnostic.probe',
      });

      return {
        background: {
          received: true,
          receivedAt: received.receivedAt,
          sequence: received.sequence,
        },
        content: {
          acknowledged: content?.acknowledged === true,
          applied: content?.applied === true,
        },
        desktop: {
          accepted: accepted?.probe_id === probeId,
          emitted: Number.isSafeInteger(accepted?.sequence),
        },
        probeId,
      };
    } finally {
      const probe = pending.get(probeId);
      if (probe !== undefined) {
        pending.delete(probeId);
        clearTimeoutFn(probe.timeoutId);
      }
    }
  }

  return { receive, testActiveTab };
}
