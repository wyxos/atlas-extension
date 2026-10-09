import { safeReactionDiagnostic, reactionDiagnosticCapability } from '../shared/reaction-diagnostics.js';
import { hasDesktopCapability } from '../shared/desktop-capabilities.js';

const storageKey = 'atlasReactionFailures';
const maxEvents = 100;

export function createReactionFailureHistory({ storage = globalThis.chrome?.storage?.local } = {}) {
  let pending = Promise.resolve();
  let flushing = null;
  let requestedContext = null;
  const serialize = (operation) => {
    const result = pending.catch(() => {}).then(operation);
    pending = result;
    return result;
  };
  async function read() {
    const value = (await storage?.get?.(storageKey))?.[storageKey];
    return Array.isArray(value) ? value.slice(-maxEvents).flatMap(entry => {
      const safe = safeReactionDiagnostic(entry);
      return safe ? [{ ...safe, delivered: entry.delivered === true }] : [];
    }) : [];
  }
  async function record(value) {
    const event = safeReactionDiagnostic(value);
    if (!event) return;
    return serialize(async () => {
      const events = await read();
      if (events.some(entry => entry.requestId === event.requestId)) return;
      await storage?.set?.({ [storageKey]: [...events, { ...event, delivered: false }].slice(-maxEvents) });
    });
  }
  async function snapshot() { await pending.catch(() => {}); return read(); }
  async function flush(context) {
    if (!hasDesktopCapability(context.credentials, reactionDiagnosticCapability)) return;
    requestedContext = context;
    if (flushing) return flushing;
    flushing = (async () => {
      // Each pass requires a new connection/failure event. A replacement pairing
      // must take over even when the preceding pairing's pending send fails.
      while (requestedContext) {
        const { credentials, transport } = requestedContext;
        requestedContext = null;
        try {
          const events = (await snapshot()).filter(entry => !entry.delivered);
          for (const event of events) {
            await transport.reactionFailure(credentials, safeReactionDiagnostic(event));
            await serialize(async () => {
              const current = await read();
              await storage?.set?.({ [storageKey]: current.map(entry => entry.requestId === event.requestId
                ? { ...entry, delivered: true } : entry) });
            });
          }
        } catch (error) {
          if (!requestedContext) throw error;
        }
      }
    })();
    try { await flushing; } finally { flushing = null; }
  }
  return { record, snapshot, flush };
}
