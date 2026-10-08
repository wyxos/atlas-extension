import assert from 'node:assert/strict';
import test from 'node:test';
import { installRequestSessionObserver, installRequestSessionRelay, requestSessionEvent } from '../src/content/request-session-observer.js';
import { createRequestSessionCapture } from '../src/background/request-session-capture.js';
const { EventTarget, Event, Headers, CustomEvent, Request } = globalThis;

function fixture() {
  const target = new EventTarget();
  const requests = [], messages = [];
  class Xhr extends EventTarget {
    open(method, url) { this.method = method; this.url = url; }
    setRequestHeader() {}
    send() { this.status = 206; this.dispatchEvent(new Event('load')); }
  }
  const windowContext = { location: { href: 'https://site.test/watch' }, Headers, XMLHttpRequest: Xhr, CustomEvent,
    addEventListener: target.addEventListener.bind(target), dispatchEvent: target.dispatchEvent.bind(target),
    fetch(input, init) { const promise = Promise.resolve({ status: 200 }); requests.push({ input, init, promise }); return promise; } };
  const chromeApi = { runtime: { sendMessage(message, done) { messages.push(message); done(); } } };
  installRequestSessionRelay(windowContext, chromeApi);
  installRequestSessionObserver(windowContext);
  return { windowContext, requests, messages };
}

test('page fetch observer forwards actual successful GET bearer headers without consuming or replacing its response', async () => {
  const { windowContext, requests, messages } = fixture();
  const input = new Request('https://cdn.test/media?signature=synthetic', { headers: { Authorization: 'Bearer first' } });
  const promise = windowContext.fetch(input, { headers: { Authorization: 'Bearer overridden', 'X-Media-Token': 'synthetic' } });
  assert.equal(promise, requests[0].promise);
  await promise;
  assert.deepEqual(messages[0].request, { url: input.url, headers: [
    { name: 'authorization', value: 'Bearer overridden' }, { name: 'x-media-token', value: 'synthetic' },
  ] });
  await windowContext.fetch('/post', { method: 'POST', headers: { Authorization: 'ignored' } });
  assert.equal(messages.length, 1);
});

test('XHR observer respects native header append and open resets, rejecting malformed relay messages', () => {
  const { windowContext, messages } = fixture();
  const xhr = new windowContext.XMLHttpRequest();
  xhr.open('GET', '/media'); xhr.setRequestHeader('Authorization', 'synthetic'); xhr.send();
  assert.equal(messages[0].request.headers[0].value, 'synthetic');
  xhr.open('GET', '/media'); xhr.send();
  assert.deepEqual(messages[1].request.headers, []);
  windowContext.dispatchEvent(new CustomEvent(requestSessionEvent, { detail: 'malformed' }));
  windowContext.dispatchEvent(new CustomEvent(requestSessionEvent, { detail: JSON.stringify({ url: 'file:///local', headers: [] }) }));
  assert.equal(messages.length, 2);
});

test('page bearer observation merges browser-set referrer, then refreshes or removes the token', () => {
  const cache = createRequestSessionCapture({ now: () => 1000 });
  const url = 'https://cdn.test/media';
  cache.observe({ tabId: 4, requestId: 'one', method: 'GET', url,
    requestHeaders: [{ name: 'Referer', value: 'https://site.test/watch' }] });
  cache.complete({ requestId: 'one', statusCode: 200 });
  cache.observePage({ tabId: 4, url, headers: [{ name: 'Authorization', value: 'Bearer first' }] });
  assert.deepEqual(cache.snapshot(4, [url])[0].headers, [
    { name: 'authorization', value: 'Bearer first' }, { name: 'referer', value: 'https://site.test/watch' },
  ]);
  cache.observePage({ tabId: 4, url, headers: [{ name: 'Authorization', value: 'Bearer next' }] });
  assert.equal(cache.snapshot(4, [url])[0].headers.find(header => header.name === 'authorization').value, 'Bearer next');
  cache.observePage({ tabId: 4, url, headers: [] });
  assert.deepEqual(cache.snapshot(4, [url])[0].headers, [{ name: 'referer', value: 'https://site.test/watch' }]);
});
