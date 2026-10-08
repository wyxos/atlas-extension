import { isSessionHeader, normalizeSessionUrl } from '../background/request-session-capture.js';

export const requestSessionEvent = 'atlas-extension-request-session';
export const requestSessionMessage = 'atlas-extension.request-session';

// Chrome's webRequest API hides Authorization. Observe the headers that page
// code actually supplies to successful GET fetch/XHR, without reading storage.
export function installRequestSessionObserver(windowContext = globalThis.window) {
  const emit = (url, headers, status) => {
    if (status < 200 || status >= 400 || !url) return;
    const values = [...headers].filter(([name]) => isSessionHeader(name.toLowerCase()))
      .map(([name, value]) => ({ name: name.toLowerCase(), value }));
    const invalid = values.length > 64 || values.some(header => header.value.length > 8192)
      || JSON.stringify(values).length > 32768;
    windowContext.dispatchEvent(new windowContext.CustomEvent(requestSessionEvent, {
      detail: JSON.stringify({ url, headers: invalid ? [] : values, ...(invalid ? { invalid: true } : {}) }),
    }));
  };
  const fetch = windowContext.fetch;
  if (typeof fetch === 'function') {
    windowContext.fetch = function atlasFetch(input, init) {
      let url, headers, method;
      try {
        url = normalizeSessionUrl(new URL(typeof input === 'string' || input instanceof URL ? input : input.url,
          windowContext.location.href).href);
        method = String(init?.method ?? input?.method ?? 'GET').toUpperCase();
        headers = new windowContext.Headers(init?.headers ?? input?.headers);
      } catch { /* Preserve the browser's own validation and original exception. */ }
      const result = fetch.apply(this, arguments);
      if (method === 'GET' && url && headers) {
        // Observe fulfillment separately; never replace the page's Promise or
        // consume a response body. Rejections retain native fetch behavior.
        void result.then(response => { try { emit(url, headers, response.status); } catch { /* Page remains usable. */ } }, () => {});
      }
      return result;
    };
  }
  const xhr = windowContext.XMLHttpRequest?.prototype;
  if (!xhr) return;
  const state = new WeakMap();
  const open = xhr.open, setRequestHeader = xhr.setRequestHeader, send = xhr.send;
  xhr.open = function atlasOpen(method, url) {
    const result = open.apply(this, arguments);
    try { state.set(this, { method: String(method).toUpperCase(),
      url: normalizeSessionUrl(new URL(url, windowContext.location.href).href), headers: new windowContext.Headers() }); }
    catch { state.delete(this); }
    return result;
  };
  xhr.setRequestHeader = function atlasHeader(name, value) {
    const result = setRequestHeader.apply(this, arguments);
    try { state.get(this)?.headers.append(name, value); } catch { /* Native behavior already succeeded. */ }
    return result;
  };
  xhr.send = function atlasSend() {
    const request = state.get(this);
    if (request?.method === 'GET') this.addEventListener('load', () => {
      try { emit(request.url, request.headers, this.status); } catch { /* Page remains usable. */ }
    }, { once: true });
    return send.apply(this, arguments);
  };
}

export function installRequestSessionRelay(windowContext = globalThis.window, chromeApi = globalThis.chrome) {
  windowContext.addEventListener(requestSessionEvent, event => {
    if (typeof event.detail !== 'string' || event.detail.length > 40000) return;
    let request;
    try { request = JSON.parse(event.detail); } catch { return; }
    if (!normalizeSessionUrl(request?.url) || !Array.isArray(request.headers) || request.headers.length > 64) return;
    try { chromeApi?.runtime?.sendMessage?.({ type: requestSessionMessage, request }, () => { void chromeApi.runtime.lastError; }); }
    catch { /* A retired extension context cannot prevent the page request. */ }
  });
}
