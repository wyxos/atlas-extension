import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';

// Declarative descriptors exercise the same generic runtime for an unknown
// package. This fixture never contacts a real provider or Desktop database.
export async function providerActionsFixture(runtimeId) {
  const events = new EventEmitter(); const sockets = new Set(); const requests = []; const unexpected = [];
  let origin; let sequence = 0; let enabled = true; let version = '1@fixture'; let fail = false; let actionGate = null;
  const creatorSelector = '[class*="CreatorCard"][class*="profileDetails"] a[href^="/user/"]';
  const actions = [{ id: 'model', label: 'Open model in Atlas', target: 'page', selector: '[class*="detailRowTop"]:has(code[class*="ModelURN"])',
    fallbackSelector: 'h1', queryFilters: [{ parameter: 'modelVersionId', containerType: 'ModelVersion',
      fallback: { selector: '[class*="detailRowTop"] code[class*="ModelURN"]', prefix: 'civitai:', format: 'model-urn' } }],
    pathPattern: '^/models/([0-9]+)', containerType: 'model', sourceGroup: 1 },
  { id: 'creator', label: 'Open user in Atlas', target: 'link', selector: creatorSelector,
    placementSelector: '[class*="CreatorCard"][class*="profileDetailsContainer"]',
    pathPattern: '^/user/([A-Za-z0-9_-]+)/?$', containerType: 'user', sourceGroup: 1 }];
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, origin);
      if (url.pathname === '/favicon.ico') { response.writeHead(204); response.end(); return; }
      if (!url.pathname.startsWith('/v1/')) {
        if (url.pathname.includes('/art/')) {
          response.writeHead(200, { 'Content-Type': 'text/html' });
          response.end('<!doctype html><html><head><title>Synthetic deviation</title><style>body{margin:24px;background:#10141b;color:#edf0f6;font:16px/1.5 system-ui}main{max-width:720px}</style></head><body><main><h1>Synthetic deviation</h1><p>Creator: tolstijmoo</p></main></body></html>');
          return;
        }
        const hiddenCopy = url.searchParams.has('hiddenCopy') ? `
          <div hidden class="responsive-copy"><div class="CreatorCard-module___fixture__profileDetailsContainer"><div class="CreatorCard-module___fixture__profileDetails">
            <a id="hidden-creator" href="/user/Hidden_AI"><p>Hidden_AI</p></a>
          </div></div><p data-variant="gradient" data-size="xl" data-line-clamp="true">Hidden_AI</p></div>` : '';
        response.writeHead(200, { 'Content-Type': 'text/html' });
        response.end(`<!doctype html><html><head><title>Atlas provider action fixture</title><style>
          body{margin:24px;background:#10141b;color:#edf0f6;font:16px/1.5 system-ui}main{max-width:720px}a{color:#86c0fc}
          .CreatorCard-module___fixture__profileDetailsContainer{margin-top:24px;padding:12px;background:#18212d}
          .CreatorCard-module___fixture__profileDetails{max-width:100%}p{margin:0}code{overflow-wrap:anywhere}
        </style></head><body>${hiddenCopy}<main><h1>Synthetic model page</h1><section id="model-target" class="ModelVersionDetails-module___fixture__detailRowTop"><code class="ModelURN-module___fixture__code">civitai:2726029@3064584+2943406</code></section>
          <a id="unsafe" href="javascript:void(0)">Unsafe link</a><a id="nav-user" href="/user/Navigation">Navigation user</a>
          <div class="CreatorCard-module___fixture__profileDetailsContainer"><div class="CreatorCard-module___fixture__profileDetails"><div style="overflow:hidden"><a id="creator" href="/user/Adel_AI"><div><p data-variant="gradient" data-size="md">Adel_AI</p></div></a></div></div></div>
          <p id="user-heading" ${url.searchParams.has('plainProfile') ? '' : 'data-variant="gradient"'} data-size="xl" data-line-clamp="true">Adel_AI</p>
        </main></body></html>`);
        return;
      }
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
      const json = data => { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ ok: true, data })); };
      if (url.pathname === '/v1/hello') {
        json({ app: { channel: 'dev', runtime_id: runtimeId }, protocol_version: 1,
          capabilities: ['browser-provider-resolution-v1', 'browser-container-actions-v1', 'close-tab-mode', 'batch-provider-preference', 'browser-authenticated-download-v1'] });
        return;
      }
      if (url.pathname === '/v1/pairings') { json({ client_id: 'fixture-client', client_token: 'fixture-token' }); return; }
      assert.equal(request.headers.authorization, 'Bearer fixture-token');
      if (url.pathname === '/v1/runtime-policy') json({ revision: 1, settings: { schemaVersion: 1, settings: {
        assetSourcePreferences: { version: 3, domains: [], profiles: [] }, closeTabPreferences: { version: 1, modesBySiteDomain: {} },
      } } });
      else if (url.pathname === '/v1/browser/resolve') {
        json({ pages: body.pages.map(({ url: pageUrl }) => ({ url: pageUrl, provider: enabled ? 'unrecognized-gallery' : null,
          profileVersion: version, canonicalPage: pageUrl, identity: null, gallery: null,
          actions: !enabled ? [] : new URL(pageUrl).pathname.includes('/art/') ? [{ id: 'deviation-user', label: 'Open user in Atlas',
            target: 'page', selector: 'h1', pathPattern: '^/([A-Za-z0-9_-]+)/art/', containerType: 'user', sourceGroup: 1 }]
            : new URL(pageUrl).pathname.startsWith('/models/') ? actions : [{ ...actions[1],
            id: 'user-profile', target: 'page', selector: 'p[data-size="xl"][data-line-clamp="true"]',
            pathPattern: '^/user/([A-Za-z0-9_-]+)/?$', placementSelector: null }] })) });
      } else if (url.pathname === '/v1/events/tickets') json({ websocket_url: `${origin.replace('http:', 'ws:')}/v1/events?ticket=fixture` });
      else if (url.pathname === '/v1/assets/status') json({ assets: {}, referrers: {}, matches: {} });
      else if (url.pathname === '/v1/browser/open-container') {
        assert.equal(request.method, 'POST'); assert.ok(request.headers['idempotency-key']);
        requests.push(body);
        events.emit('action', body);
        if (actionGate) { const waiting = actionGate; actionGate = null; await waiting; }
        if (fail) { response.writeHead(409, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ ok: false, error: { code: 'PROVIDER_UNAVAILABLE', message: 'Unavailable.', retryable: true } })); }
        else json({ opened: true });
      } else { unexpected.push(`${request.method} ${url.pathname}`); response.writeHead(404); response.end(); }
    } catch (error) { unexpected.push(error.message); response.writeHead(500); response.end(); }
  });
  const websocket = new WebSocketServer({ server, path: '/v1/events' });
  websocket.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); events.emit('connected'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, port: server.address().port, requests, unexpected,
    connected: () => sockets.size ? Promise.resolve() : once(events, 'connected'),
    nextAction: () => once(events, 'action'),
    setFailure(value) { fail = value; },
    holdAction() { let release; actionGate = new Promise(resolve => { release = resolve; }); return release; },
    changeProvider(value, profileVersion = version) { enabled = value; version = profileVersion;
      for (const socket of sockets) socket.send(JSON.stringify({ sequence: ++sequence,
        type: 'browser.providers.changed', occurred_at: new Date().toISOString(), data: {} })); },
    async close() { for (const socket of sockets) socket.terminate(); await new Promise(resolve => websocket.close(resolve));
      server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); },
  };
}
