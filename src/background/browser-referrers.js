import { createBrowserResolutionCache } from '../shared/browser-resolution-cache.js';
export function createBrowserReferrers(resolve, registry) {
  const cache = createBrowserResolutionCache({ resolve });
  async function prepare(values) {
    const epoch = cache.token();
    const mappings = await cache.prepare(values);
    return { canonical: value => mappings.get(value) ?? value, isCurrent: () => epoch === cache.token() };
  }
  return {
    canonical: cache.canonical,
    clear() { cache.clear(); registry().reindexReferrers(); },
    prepare,
    async register(input) {
      // Register raw interests first. Navigation can retire this frame while
      // Desktop resolves; only that exact document/sequence may receive its keys.
      const result = registry().register({ ...input, referrerKeys: input.referrerUrls });
      if (!result.accepted) return result;
      const mapping = await prepare(input.referrerUrls);
      if (!mapping.isCurrent()) return { accepted: false, resyncRequired: true };
      const updated = registry().resolveReferrerKeys({ ...input, canonical: mapping.canonical });
      return updated ? result : { accepted: false, resyncRequired: false };
    },
  };
}

// Keep at most the current delivery plus one latest update per asset. A busy
// local bridge must not retain one asynchronous relay for every progress tick.
export function createCoalescedDownloadRelay({ deliver, limit = 256 }) {
  const pending = new Map();
  function clear() { for (const entry of pending.values()) entry.next = null; pending.clear(); }
  function submit(payload) {
    const key = payload?.assetUrl;
    if (typeof key !== 'string' || !key) return false;
    const existing = pending.get(key);
    if (existing) { existing.next = payload; return true; }
    if (pending.size >= limit) return false;
    const entry = { next: payload }; pending.set(key, entry);
    void (async () => {
      try {
        while (entry.next) {
          const next = entry.next; entry.next = null;
          await deliver(next);
        }
      } catch { /* A later event or page resync restores live status. */ }
      finally { if (pending.get(key) === entry) pending.delete(key); }
    })();
    return true;
  }
  return { clear, submit };
}
