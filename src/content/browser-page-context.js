import { resolveBrowserPagesViaBackground } from './background-api.js';

// Only one live document observation is retained. Neither provider source code
// nor a persistent copy of page metadata is stored in the browser.
export function createBrowserPageContext({ resolve = resolveBrowserPagesViaBackground, changed = () => {} } = {}) {
  let current = null;
  let observed = null;
  let pending = null;
  let generation = 0;
  let epoch = 0;
  function invalidate() { epoch += 1; generation += 1; current = null; observed = null; pending = null; }
  function get(url) { return current?.url === url ? current : null; }
  async function refresh({ url, documentContext } = {}) {
    if (typeof url !== 'string' || !url || url.length > 4096 || new globalThis.TextEncoder().encode(url).length > 4096 || containsControl(url)) { invalidate(); return; }
    const page = { url, metadata: readPageMetadata(documentContext) };
    const key = JSON.stringify(page);
    if (observed === key) return pending;
    observed = key;
    current = null;
    const ownGeneration = ++generation;
    pending = (async () => {
      try {
        const result = await resolve({ pages: [page] });
        if (generation !== ownGeneration) return;
        const resolved = result?.pages?.[0];
        if (result?.pages?.length !== 1 || resolved?.url !== url) throw new Error('Invalid browser provider response.');
        // Recheck the DOM observation: metadata may change during navigation.
        if (JSON.stringify({ url, metadata: readPageMetadata(documentContext) }) !== key) { observed = null; return; }
        current = Object.freeze(resolved);
        changed();
      } catch {
        // Offline/older Desktop retains generic capture. Retry only after an
        // explicit resync or a new page observation, not on every DOM mutation.
        if (generation === ownGeneration) { current = null; changed(); }
      } finally { if (generation === ownGeneration) pending = null; }
    })();
    return pending;
  }
  return { get, invalidate, refresh, token: () => epoch };
}

function containsControl(value) {
  for (const character of value) {
    const code = character.codePointAt(0);
    if (code < 32 || (code >= 127 && code <= 159)) return true;
  }
  return false;
}
function truncateUtf8(value, maxBytes) {
  let bytes = 0; let result = '';
  for (const character of value) {
    const code = character.codePointAt(0);
    const size = code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
    if (bytes + size > maxBytes) break;
    bytes += size; result += character;
  }
  return result;
}
export function readPageMetadata(documentContext) {
  const elements = documentContext?.querySelectorAll?.('meta[name], meta[property]') ?? [];
  const metadata = [];
  // Inspect at most 64 elements; do not copy a potentially unbounded NodeList.
  for (let index = 0; index < Math.min(elements.length, 64); index += 1) {
    const element = elements[index];
    const name = truncateUtf8(String(element.getAttribute?.('name') ?? element.getAttribute?.('property') ?? ''), 128);
    if (!name || containsControl(name)) continue;
    metadata.push({ name, content: truncateUtf8(String(element.getAttribute?.('content') ?? ''), 2048) });
  }
  return metadata;
}

export const browserPageContext = createBrowserPageContext({ changed: () => globalThis.dispatchEvent?.(new globalThis.Event('atlas-browser-provider-changed')) });

globalThis.chrome?.storage?.onChanged?.addListener?.((changes, area) => {
  const change = changes?.atlasDesktopConnection;
  if (area !== 'local' || !change) return;
  const before = change.oldValue; const after = change.newValue;
  if (before?.clientId !== after?.clientId || before?.channel !== after?.channel || before?.health !== after?.health || before?.eventStatus !== after?.eventStatus) {
    browserPageContext.invalidate();
    globalThis.dispatchEvent?.(new globalThis.Event('atlas-browser-provider-changed'));
  }
});
