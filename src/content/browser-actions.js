import { openBrowserContainerViaBackground } from './background-api.js';
import { browserActionStyles } from './browser-action-styles.js';

const hostAttribute = 'data-atlas-browser-action';
const maxActions = 16;
const maxVisitedElements = 8192;

export function safeBrowserActionUrl(value, pageUrl) {
  if (typeof value !== 'string' || value.length > 4096 || [...value].some(character => {
    const code = character.codePointAt(0); return code <= 32 || (code >= 127 && code <= 159);
  })) return null;
  try {
    const url = new globalThis.URL(value, pageUrl);
    const page = new globalThis.URL(pageUrl);
    if (!['https:', 'http:'].includes(url.protocol) || url.origin !== page.origin || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

export function browserActionTarget(action, element, pageUrl) {
  const value = action?.target === 'page' ? pageUrl
    : action?.target === 'link' ? element?.getAttribute?.('href') : null;
  // Desktop validates package path patterns with its bounded matcher. Running
  // package regexes in JavaScript could block the browser through backtracking.
  return safeBrowserActionUrl(value, pageUrl);
}

export function normalizedBrowserActions(page) {
  if (typeof page?.provider !== 'string' || !page.provider || typeof page.profileVersion !== 'string') return [];
  if (!Array.isArray(page.actions)) return [];
  return page.actions.slice(0, maxActions).filter(action =>
    typeof action?.id === 'string' && action.id.length > 0 && action.id.length <= 128
    && typeof action.label === 'string' && action.label.length > 0 && action.label.length <= 128
    && typeof action.selector === 'string' && action.selector.length > 0 && action.selector.length <= 1024
    && (action.placementSelector == null || (typeof action.placementSelector === 'string' && action.placementSelector.length <= 256))
    && (action.fallbackSelector == null || (typeof action.fallbackSelector === 'string' && action.fallbackSelector.length <= 256))
    && ['page', 'link'].includes(action.target));
}

// One control per declared action avoids repeated profile links creating a
// page full of controls. Scan only bounded event-supplied subtrees; no polling.
export function createBrowserActions({ documentContext = globalThis.document,
  getPageUrl = () => globalThis.location.href, getPage, open = openBrowserContainerViaBackground } = {}) {
  const entries = new Map();
  let activeScope = null;
  function remove(id) {
    const entry = entries.get(id);
    entry?.host.remove();
    entries.delete(id);
  }
  function prune() {
    let rescan = false;
    const pageUrl = getPageUrl();
    const page = getPage(pageUrl);
    const actions = normalizedBrowserActions(page);
    const scope = JSON.stringify([pageUrl, page?.provider, page?.profileVersion, actions]);
    if (scope !== activeScope) {
      for (const id of entries.keys()) remove(id);
      activeScope = scope;
    }
    for (const [id, entry] of entries) {
      if (!entry.element.isConnected || !entry.host.isConnected
        || !isRendered(entry.element, documentContext)
        || !(entry.element.matches(entry.action.selector) || (entry.action.fallbackSelector && entry.element.matches(entry.action.fallbackSelector)))
        || browserActionTarget(entry.action, entry.element, pageUrl) !== entry.targetUrl) {
        remove(id); rescan = true;
      }
    }
    return { actions, page, pageUrl, rescan };
  }
  function sync(root = documentContext) {
    const { actions, page, pageUrl, rescan } = prune();
    // A responsive copy can hide while its visible sibling remains unchanged.
    // Revisit the bounded document scan when an existing target is invalidated.
    if (rescan) root = documentContext;
    if (!actions.length || root?.closest?.(`[${hostAttribute}]`)) return;
    for (const action of actions) {
      const existing = entries.get(action.id);
      if (existing && !existing.isFallback) continue;
      const primary = findTarget(root, action, pageUrl, documentContext);
      if (existing && !primary) continue;
      if (existing) remove(action.id);
      const element = primary ?? (action.fallbackSelector
        ? findTarget(root, { ...action, selector: action.fallbackSelector }, pageUrl, documentContext) : null);
      if (!element) continue;
      const targetUrl = browserActionTarget(action, element, pageUrl);
      const host = documentContext.createElement('span');
      host.setAttribute(hostAttribute, action.id);
      const shadow = host.attachShadow({ mode: 'open' });
      const style = documentContext.createElement('style');
      style.textContent = browserActionStyles();
      const surface = documentContext.createElement('span');
      surface.className = 'action';
      const button = documentContext.createElement('button');
      button.type = 'button'; button.textContent = action.label;
      const status = documentContext.createElement('span');
      status.className = 'status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
      surface.append(button, status); shadow.append(style, surface);
      const entry = { action, element, targetUrl, host, button, status, isFallback: !primary };
      entries.set(action.id, entry);
      // Keep the button outside surrounding anchors, even if a package matches
      // a heading or inline child. Page click handlers cannot navigate the link.
      let placement;
      try { placement = action.placementSelector ? element.closest(action.placementSelector) : null; }
      catch { remove(action.id); continue; }
      const anchor = (placement ?? element).closest('a');
      (anchor ?? placement ?? element).after(host);
      for (const name of ['mousedown', 'auxclick', 'keydown']) host.addEventListener(name, event => event.stopPropagation());
      button.addEventListener('click', async event => {
        event.preventDefault(); event.stopPropagation();
        prune();
        if (entries.get(action.id) !== entry || button.disabled) return;
        button.disabled = true; button.setAttribute('aria-busy', 'true');
        button.textContent = 'Opening…'; status.textContent = '';
        try {
          const observations = browserActionObservations(action, documentContext, pageUrl);
          await open({ pageUrl, targetUrl, provider: page.provider, profileVersion: page.profileVersion, actionId: action.id,
            ...(observations.length ? { observations } : {}) });
          if (entries.get(action.id) !== entry) return;
          button.textContent = 'Opened in Atlas'; button.dataset.state = 'success';
          status.textContent = 'Feed opened in Atlas.';
        } catch {
          if (entries.get(action.id) !== entry) return;
          button.textContent = action.label; button.dataset.state = 'error';
          status.textContent = 'Could not open Atlas. Reconnect the extension and try again.';
        } finally {
          if (entries.get(action.id) === entry) { button.disabled = false; button.removeAttribute('aria-busy'); }
        }
      });
    }
  }
  function clear() { for (const id of entries.keys()) remove(id); activeScope = null; }
  return { sync, prune, clear };
}

function findTarget(root, action, pageUrl, documentContext) {
  if (!root || ![1, 9, 11].includes(root.nodeType)) return null;
  // TreeWalker does not allocate all matching nodes for a broad package selector.
  const walker = documentContext.createTreeWalker(root, 1);
  let element = root.nodeType === 1 ? root : walker.nextNode();
  let visited = 0;
  while (element && visited++ < maxVisitedElements) {
    try {
      if (!element.closest(`[${hostAttribute}]`) && element.matches(action.selector) && isRendered(element, documentContext)
        && browserActionTarget(action, element, pageUrl)) return element;
    } catch { return null; }
    element = walker.nextNode();
  }
  return null;
}

function isRendered(element, documentContext) {
  // Offscreen targets remain eligible; hidden responsive duplicates do not.
  if (!element.getClientRects?.().length) return false;
  const style = documentContext.defaultView?.getComputedStyle(element);
  return style?.visibility !== 'hidden' && style?.visibility !== 'collapse';
}

export function browserActionObservations(action, documentContext, pageUrl) {
  const observations = [];
  const parameters = new globalThis.URL(pageUrl).searchParams;
  for (const filter of (Array.isArray(action.queryFilters) ? action.queryFilters.slice(0, 8) : [])) {
    const fallback = filter?.fallback;
    if (typeof filter?.parameter !== 'string' || filter.parameter.length > 64 || Boolean(parameters.get(filter.parameter)?.trim())
      || fallback?.format !== 'model-urn' || typeof fallback.selector !== 'string' || fallback.selector.length > 256
      || typeof fallback.prefix !== 'string' || fallback.prefix.length > 64) continue;
    const walker = documentContext.createTreeWalker(documentContext, 1);
    let node = walker.nextNode(); let visited = 0; let matched = 0; let value = ''; let invalid = false;
    while (node && visited++ < maxVisitedElements && matched < 8) {
      try {
        if (!node.closest(`[${hostAttribute}]`) && node.matches(fallback.selector)) {
          matched += 1;
          const rawText = String(node.textContent ?? '');
          if (rawText.length > 128) { invalid = true; break; }
          const text = rawText.trim();
          if (value.length + text.length > 128) { invalid = true; break; }
          value += text;
        }
      } catch { invalid = true; break; }
      node = walker.nextNode();
    }
    value = value.trim();
    if (!invalid && value && value.startsWith(fallback.prefix)) observations.push({ parameter: filter.parameter, value });
  }
  return observations;
}
