export const galleryError = code => Object.assign(new Error(code), { code, retryable: true });

export function assertNotCancelled(signal) {
  if (signal?.aborted) throw galleryError('BATCH_CANCELLED');
}

export function mediaIdentity(source) {
  const url = new URL(source);
  // Query parameters may identify different media for an unknown provider.
  // Only fragments are transport-independent without an identity contract.
  url.hash = '';
  return url.href;
}

export function createCollection({ onItem, onProgress, assertCurrent, signal }) {
  const items = typeof onItem === 'function' ? null : [];
  const identities = new Set();
  let collected = 0;
  let total = null;
  const assertUsable = () => { assertCurrent(); assertNotCancelled(signal); };
  const progress = async (phase = 'collecting', nextTotal = total, restoring = false) => {
    (restoring ? assertCurrent : assertUsable)();
    total = nextTotal;
    await onProgress?.({ phase, collected, total });
    (restoring ? assertCurrent : assertUsable)();
  };
  return {
    assertUsable, get collected() { return collected; },
    progress,
    async emit(item) {
      assertUsable();
      if (!item) throw galleryError('BATCH_INCOMPLETE');
      const identity = mediaIdentity(item.asset.source);
      if (!identities.has(identity)) {
        await onItem?.(item);
        assertUsable();
        identities.add(identity);
        items?.push(item);
        collected += 1;
      }
      await progress();
    },
    result: () => items ?? [],
  };
}

// Gallery inventories can be large. Rescan only after relevant DOM mutations;
// selection/media updates outside the inventory do not turn a traversal into
// repeated full-gallery scans. Non-DOM callers keep conservative fresh reads.
export function createGalleryInventory(read, { roots, documentContext, attributes, relevant = () => true }) {
  let value = read();
  let dirty = false;
  const observers = [];
  const mark = records => { if (records.some(relevant)) dirty = true; };
  const Observer = documentContext?.defaultView?.MutationObserver ?? globalThis.MutationObserver;
  if (Observer) for (const root of [...new Set(roots.filter(Boolean))]) {
    const observer = new Observer(mark);
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: attributes });
    observers.push(observer);
  }
  return {
    current() {
      observers.forEach(observer => mark(observer.takeRecords?.() ?? []));
      if (!observers.length || dirty) { value = read(); dirty = false; }
      return value;
    },
    disconnect() { observers.forEach(observer => observer.disconnect()); },
  };
}

// Time bounds apply to one stalled navigation/load, never to a whole gallery.
// DOM and media events avoid polling during long galleries or slow downloads.
export function waitForGalleryCondition(predicate, timeoutMs, {
  roots = [], documentContext = globalThis.document, signal,
} = {}) {
  return new Promise((resolve, reject) => {
    const observers = [];
    const eventRoots = [...new Set([documentContext, ...roots].filter(Boolean))];
    // currentSrc and readyState can change without an attribute mutation.
    const mediaEvents = ['load', 'error', 'loadedmetadata', 'loadeddata', 'canplay', 'emptied'];
    let timer;
    let settled = false;
    const cleanup = () => {
      globalThis.clearTimeout(timer);
      observers.forEach(observer => observer.disconnect());
      eventRoots.forEach(root => {
        mediaEvents.forEach(event => root.removeEventListener?.(event, check, { capture: true }));
        root.removeEventListener?.('gallerychange', check);
      });
      signal?.removeEventListener('abort', check);
    };
    const finish = (value, error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error); else resolve(value);
    };
    const check = () => {
      try { assertNotCancelled(signal); if (predicate()) finish(true); }
      catch (error) { finish(false, error); }
    };
    const Observer = documentContext?.defaultView?.MutationObserver ?? globalThis.MutationObserver;
    if (Observer) for (const root of [...new Set(roots.filter(Boolean))]) {
      const observer = new Observer(check);
      observer.observe(root, { childList: true, subtree: true, attributes: true });
      observers.push(observer);
    }
    eventRoots.forEach(root => {
      mediaEvents.forEach(event => root.addEventListener?.(event, check, { capture: true }));
      root.addEventListener?.('gallerychange', check);
    });
    signal?.addEventListener('abort', check, { once: true });
    timer = globalThis.setTimeout(() => {
      // Check once at the deadline as a fallback for DOMs without event APIs.
      check();
      finish(false);
    }, Math.max(0, timeoutMs));
    check();
  });
}
