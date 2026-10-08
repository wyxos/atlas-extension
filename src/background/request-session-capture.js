import { createDesktopContractError } from '../shared/desktop-contract.js';

const allowedHeaders = new Set(['authorization', 'origin', 'referer', 'user-agent', 'accept', 'accept-language']);

export function normalizeSessionUrl(value) {
  try {
    const url = new URL(value);
    if (typeof value !== 'string' || value.length > 8192
      || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    url.hash = '';
    return url.href;
  } catch { return null; }
}

export function isSessionHeader(name) {
  return allowedHeaders.has(name) || (/^x-[a-z0-9-]+$/.test(name)
    && !/^x-(forwarded|proxy|real-ip|atlas|debug)(-|$)/.test(name)
    && !['x-host', 'x-original-url', 'x-rewrite-url'].includes(name));
}

// Credentials stay only in bounded worker memory. No storage, logging, polling,
// or browser fetches: only requests the originating tab actually made.
export function createRequestSessionCapture({ now = () => Date.now(), maxTabs = 64,
  maxRequestsPerTab = 128, maxPending = 256, maxBytes = 2 * 1024 * 1024, maxAgeMs = 30 * 60 * 1000 } = {}) {
  const tabs = new Map();
  const pending = new Map();
  const pendingPage = new Map();
  let totalBytes = 0;

  function removeTab(tabId) {
    for (const entry of tabs.get(tabId)?.values() ?? []) totalBytes -= entry.accountedBytes;
    tabs.delete(tabId);
    for (const [key, entry] of pending) if (entry.tabId === tabId) pending.delete(key);
    for (const [key, entry] of pendingPage) if (entry.tabId === tabId) pendingPage.delete(key);
  }
  function observe(details) {
    if (!Number.isInteger(details.tabId) || details.tabId < 0 || details.method !== 'GET') return;
    const url = normalizeSessionUrl(details.url);
    if (!url) return;
    const headers = [];
    let size = 0;
    let invalid = false;
    for (const header of details.requestHeaders ?? []) {
      const name = String(header.name ?? '').toLowerCase();
      if (!isSessionHeader(name)) continue;
      const value = header.value;
      if (typeof value !== 'string' || /[\r\n\0]/.test(value) || value.length > 8192) { invalid = true; break; }
      size += name.length + value.length;
      if (size > 32768 || headers.length >= 64) { invalid = true; break; }
      headers.push({ name, value });
    }
    pending.delete(details.requestId);
    pending.set(details.requestId, { tabId: details.tabId, frameId: details.frameId ?? 0,
      documentId: details.documentId, type: details.type ?? 'other', url, headers, invalid,
      bytes: 2 * (url.length + size), capturedAt: now() });
    while (pending.size > maxPending) pending.delete(pending.keys().next().value);
  }
  function complete(details) {
    const entry = pending.get(details.requestId);
    pending.delete(details.requestId);
    if (!entry || details.statusCode < 200 || details.statusCode >= 400) return;
    entry.browserAccepted = true;
    entry.acceptedAt = now();
    entry.browserHeaders = entry.headers;
    mergePendingPage(entry);
    persist(entry);
  }
  function persist(entry) {
    let requests = tabs.get(entry.tabId);
    if (!requests) requests = new Map();
    const key = requestKey(entry);
    totalBytes -= requests.get(key)?.accountedBytes ?? 0;
    requests.delete(key);
    requests.set(key, entry);
    totalBytes += entry.bytes;
    entry.accountedBytes = entry.bytes;
    while (requests.size > maxRequestsPerTab) {
      const first = requests.keys().next().value;
      totalBytes -= requests.get(first).accountedBytes;
      requests.delete(first);
    }
    tabs.delete(entry.tabId);
    tabs.set(entry.tabId, requests);
    while (tabs.size > maxTabs || totalBytes > maxBytes) removeTab(tabs.keys().next().value);
  }
  function observePage(details) {
    if (!Array.isArray(details.headers) || details.headers.length > 64) return;
    const requestId = Symbol('page-request');
    observe({ tabId: details.tabId, frameId: details.frameId, documentId: details.documentId,
      requestId, type: 'xmlhttprequest', url: details.url, method: 'GET', requestHeaders: details.headers });
    const entry = pending.get(requestId);
    pending.delete(requestId);
    if (!entry) return;
    entry.invalid ||= details.invalid === true;
    entry.pageHeaders = entry.headers;
    entry.pageCapturedAt = entry.capturedAt;
    const key = requestKey(entry);
    pendingPage.delete(key);
    pendingPage.set(key, entry);
    while (pendingPage.size > maxPending) pendingPage.delete(pendingPage.keys().next().value);
    const accepted = tabs.get(entry.tabId)?.get(key);
    if (accepted?.browserAccepted && Math.abs(now() - accepted.acceptedAt) <= 1000) {
      mergePendingPage(accepted);
      persist(accepted);
    }
  }
  function mergePendingPage(entry) {
    const key = requestKey(entry);
    const page = pendingPage.get(key);
    if (!page) return;
    pendingPage.delete(key);
    // Page DOM events are untrusted. Only the browser's accepted GET record can
    // authorize this exact frame/document URL as a cookie/header capture scope.
    // One second accommodates event delivery ordering without any timer.
    if (Math.abs(entry.acceptedAt - page.pageCapturedAt) > 1000) return;
    entry.invalid ||= page.invalid;
    entry.headers = mergeHeaders(page.pageHeaders, entry.browserHeaders);
    entry.bytes = 2 * (entry.url.length + JSON.stringify(entry.headers).length);
  }
  function finish(details) {
    const entry = tabs.get(details.tabId)?.get(requestKey({ ...details, url: normalizeSessionUrl(details.url) }));
    if (!entry?.browserAccepted || details.statusCode < 200 || details.statusCode >= 400) return;
    // XHR load can follow response headers by seconds while a body streams.
    // Browser completion is a second trusted, event-driven merge boundary.
    entry.acceptedAt = now(); mergePendingPage(entry); persist(entry);
  }
  function snapshot(tabId, urls, scope = {}) {
    const requests = tabs.get(tabId);
    const roots = new Set(urls.map(normalizeSessionUrl).filter(Boolean));
    const topPage = normalizeSessionUrl(scope.topPageUrl);
    const sameDocument = entry => entry.frameId === (scope.frameId ?? 0)
      && (scope.documentId === undefined || entry.documentId === scope.documentId);
    const entries = [...requests?.values() ?? []].filter(entry =>
      (sameDocument(entry) && (roots.has(entry.url)
        || (['media', 'xmlhttprequest'].includes(entry.type) && now() - entry.capturedAt <= maxAgeMs)))
      || (topPage && entry.url === topPage && entry.frameId === 0));
    // Keep selected roots first. Cross-origin manifests/fragments/API requests
    // belong to the sending document, and retain exact URL scopes; credentials
    // never become host-wide or leak into another frame's session.
    entries.sort((a, b) => Number(roots.has(b.url)) - Number(roots.has(a.url)));
    const byUrl = new Map();
    for (const entry of entries) {
      const previous = byUrl.get(entry.url);
      if (previous && JSON.stringify(previous.headers) !== JSON.stringify(entry.headers)) {
        throw createDesktopContractError('BROWSER_SESSION_AMBIGUOUS',
          'The selected page and frame use different credentials for the same request. Send the media from its own page.', true);
      }
      byUrl.set(entry.url, entry);
    }
    const result = [...byUrl.values()].flatMap(entry => {
      if (entry.invalid || entry.headers.length > 64 || JSON.stringify(entry.headers).length > 32768) throw createDesktopContractError('BROWSER_SESSION_HEADERS_INVALID',
        'The browser authentication headers exceed supported limits. Refresh the page and retry.', true);
      // A bounded freshness check is required for short-lived bearer tokens.
      // It runs only when sending a download; it creates no recurring timer.
      if (now() - entry.capturedAt > maxAgeMs) throw createDesktopContractError('BROWSER_SESSION_EXPIRED',
        'The captured browser request has expired. Refresh the page and send the file again.', true);
      return [{ url: entry.url, headers: entry.headers.map(header => ({ ...header })) }];
    });
    if (result.length > 128 || new globalThis.TextEncoder().encode(JSON.stringify(result)).length > 256 * 1024) {
      throw createDesktopContractError('BROWSER_SESSION_TOO_LARGE', 'The captured browser request context exceeds supported limits.', true);
    }
    return result;
  }
  function bind(chromeApi = globalThis.chrome) {
    const filter = { urls: ['http://*/*', 'https://*/*'] };
    chromeApi?.webRequest?.onBeforeRequest?.addListener?.(details => {
      if (details.type === 'main_frame') removeTab(details.tabId);
    }, filter);
    chromeApi?.webRequest?.onBeforeSendHeaders?.addListener?.(observe, filter, ['requestHeaders', 'extraHeaders']);
    // Streaming media can stay open until playback ends. Capture once the server
    // accepts the request, without waiting for all media bytes to arrive.
    chromeApi?.webRequest?.onResponseStarted?.addListener?.(complete, filter);
    chromeApi?.webRequest?.onCompleted?.addListener?.(finish, filter);
    chromeApi?.webRequest?.onBeforeRedirect?.addListener?.(complete, filter);
    chromeApi?.webRequest?.onErrorOccurred?.addListener?.(details => pending.delete(details.requestId), filter);
    chromeApi?.tabs?.onRemoved?.addListener?.(removeTab);
    chromeApi?.runtime?.onMessage?.addListener?.((message, sender) => {
      if (message?.type !== 'atlas-extension.request-session' || !normalizeSessionUrl(sender?.url)) return false;
      observePage({ tabId: sender?.tab?.id, frameId: sender?.frameId ?? 0, documentId: sender?.documentId,
        url: message.request?.url, headers: message.request?.headers, invalid: message.request?.invalid });
      return false;
    });
  }
  return { observe, observePage, complete, finish, snapshot, removeTab, bind };
}

function mergeHeaders(browser, page) {
  const headers = new Map(browser.map(header => [header.name, header]));
  for (const header of page) headers.set(header.name, header);
  return [...headers.values()];
}

function requestKey(entry) { return JSON.stringify([entry.frameId ?? 0, entry.documentId ?? '', entry.url]); }
