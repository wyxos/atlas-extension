// Desktop resolves provider rules. The browser keeps bounded results and merges
// concurrent lookups by URL instead of queuing whole tab snapshots per event.
export function createBrowserResolutionCache({ resolve, limit = 4096 }) {
  const pages = new Map();
  const pending = new Map();
  let generation = 0;
  let running = false;
  let capacity = null;
  function releaseCapacity() { capacity?.complete(); capacity = null; }
  const bytes = new globalThis.TextEncoder();
  function valid(url) {
    if (typeof url !== 'string' || !url.length || url.length > 4096) return false;
    for (const character of url) if (character.codePointAt(0) < 32 || (character.codePointAt(0) >= 127 && character.codePointAt(0) <= 159)) return false;
    return bytes.encode(url).length <= 4096;
  }
  function clear() {
    generation += 1;
    pages.clear();
    for (const [url, entry] of pending) entry.complete(url);
    pending.clear();
    releaseCapacity();
  }
  function canonical(value) { return pages.get(value) ?? value; }
  function remember(url, value) {
    pages.delete(url); pages.set(url, value);
    while (pages.size > limit) pages.delete(pages.keys().next().value);
  }
  function lookup(url, epoch) {
    if (epoch !== generation) return Promise.resolve(url);
    if (pages.has(url)) return Promise.resolve(pages.get(url));
    if (pending.has(url)) return pending.get(url).promise;
    if (pending.size >= limit) {
      if (!capacity) {
        let complete; const promise = new Promise(done => { complete = done; });
        capacity = { promise, complete };
      }
      return capacity.promise.then(() => lookup(url, epoch));
    }
    let complete;
    const promise = new Promise(done => { complete = done; });
    pending.set(url, { promise, complete, active: false });
    if (!running) { running = true; queueMicrotask(() => { void drain(); }); }
    return promise;
  }
  async function drain() {
    try {
      while (pending.size) {
        const batch = [...pending.entries()].filter(([, entry]) => !entry.active).slice(0, 100);
        if (!batch.length) break;
        const epoch = generation;
        for (const [, entry] of batch) entry.active = true;
        let result;
        try {
          result = await resolve({ pages: batch.map(([url]) => ({ url })) });
          if (!Array.isArray(result?.pages) || result.pages.length !== batch.length
            || result.pages.some((page, index) => page?.url !== batch[index][0] || typeof page.canonicalPage !== 'string')) result = null;
        } catch { result = null; }
        for (const [index, [url, entry]] of batch.entries()) {
          if (generation !== epoch || pending.get(url) !== entry) continue;
          const value = result?.pages[index]?.canonicalPage ?? url;
          remember(url, value);
          pending.delete(url);
          entry.complete(value);
        }
        releaseCapacity();
      }
    } finally { running = false; }
  }
  async function prepare(values) {
    const epoch = generation;
    const urls = [...new Set((Array.isArray(values) ? values : []).filter(valid))];
    const resolved = new Map();
    for (let offset = 0; offset < urls.length && generation === epoch; offset += 100) {
      const batch = urls.slice(offset, offset + 100);
      const results = await Promise.all(batch.map(url => lookup(url, epoch)));
      for (const [index, url] of batch.entries()) resolved.set(url, results[index]);
    }
    return resolved;
  }
  return { canonical, clear, prepare, token: () => generation };
}
