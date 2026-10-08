import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';

// Only Desktop is simulated. Chromium runs the built extension's actual
// service worker, content scripts, tab events, WebSocket and Vue badge renderer.
export async function nestedLinksFixture(runtimeId) {
  const events = new EventEmitter();
  const sockets = new Set();
  const reactions = [];
  const unexpected = [];
  let sequence = 0;
  let current = null;
  let origin;
  const image = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="140"><rect width="240" height="140" fill="#486b91"/></svg>`);
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, origin);
      if (url.pathname === '/favicon.ico') {
        response.writeHead(204);
        response.end();
        return;
      }
      if (url.pathname.startsWith('/media/')) {
        response.writeHead(200, { 'Content-Type': 'image/svg+xml' });
        response.end(image);
        return;
      }
      if (url.pathname.startsWith('/pages/')) {
        const name = url.pathname.split('/').at(-1);
        const links = name === 'a' ? [1, 2, 3, 4] : name === '2' ? [1, 3] : [];
        const cards = links.map(number => `<a id="link-${number}" href="/pages/${number}" target="_blank" rel="opener"><img width="240" height="140" src="/media/thumb-${number}.svg" alt="Link ${number}"></a>`).join('');
        response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
        response.end(`<!doctype html><html><head><title>Atlas nested links fixture</title><style>body{margin:20px;font-family:sans-serif}main{display:flex;flex-wrap:wrap;gap:16px}a{display:block;width:240px}img{display:block}</style></head><body><h1>Tab ${name.toUpperCase()}</h1><main>${cards || '<img id="file-3" width="240" height="140" src="/media/full-3.svg" alt="File 3">'}</main></body></html>`);
        return;
      }
      const body = await readBody(request);
      const json = data => {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ ok: true, data }));
      };
      if (url.pathname === '/v1/hello') {
        json({ app: { channel: 'dev', runtime_id: runtimeId }, protocol_version: 1,
          capabilities: ['browser-provider-resolution-v1', 'close-tab-mode', 'batch-provider-preference'] });
        return;
      }
      if (url.pathname === '/v1/pairings') {
        json({ client_id: 'fixture-client', client_token: 'fixture-token' });
        return;
      }
      assert.equal(request.headers.authorization, 'Bearer fixture-token');
      if (url.pathname === '/v1/runtime-policy') {
        json({ revision: 1, settings: { schemaVersion: 1, settings: {
          assetSourcePreferences: { version: 3, domains: ['127.0.0.1'], profiles: [] },
          closeTabPreferences: { version: 1, modesBySiteDomain: {} },
        } } });
      } else if (url.pathname === '/v1/browser/resolve') {
        json({ pages: body.pages.map(({ url: pageUrl }) => ({ url: pageUrl,
          canonicalPage: pageUrl, provider: null, identity: null, gallery: null })) });
      } else if (url.pathname === '/v1/events/tickets') {
        json({ websocket_url: `${origin.replace('http:', 'ws:')}/v1/events?ticket=fixture` });
      } else if (url.pathname === '/v1/assets/status') {
        // Never supply reacted state through a status lookup: A must update
        // from pushed events, without a reload, focus refresh or retry masking it.
        json({ assets: {}, referrers: {}, matches: {} });
        events.emit('status', body);
      } else if (url.pathname === '/v1/reactions') {
        reactions.push(body);
        current = { assetUrl: body.asset_url, referrerUrl: body.referrer_url,
          file: { id: 103, url: body.asset_url, referrer_url: body.referrer_url,
            preview_url: body.asset_url }, reaction: { type: body.type },
          download: { file_id: 103, transfer_id: 503, generation: 1,
            status: 'queued', progress_percent: 0 } };
        json({ queued: true, asset_url: current.assetUrl, file: current.file,
          reaction: current.reaction, download: current.download });
        events.emit('reaction', body);
      } else {
        unexpected.push(`${request.method} ${url.pathname}`);
        response.writeHead(404);
        response.end();
      }
    } catch (error) {
      unexpected.push(error.message);
      response.writeHead(500);
      response.end();
    }
  });
  const websocket = new WebSocketServer({ server, path: '/v1/events' });
  websocket.on('connection', socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    events.emit('connected');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin, port: server.address().port, reactions, unexpected,
    connected: () => sockets.size ? Promise.resolve() : once(events, 'connected'),
    nextReaction: () => once(events, 'reaction'),
    nextStatus: predicate => new Promise(resolve => {
      const listener = body => {
        if (!predicate || predicate(body)) {
          events.off('status', listener);
          resolve(body);
        }
      };
      events.on('status', listener);
    }),
    push(status, percent, { reaction = false } = {}) {
      assert.ok(current, 'React in C before publishing transfer events');
      assert.ok(sockets.size, 'The real extension WebSocket must be connected');
      const download = { ...current.download, status, progress_percent: percent };
      const data = { assetUrl: current.assetUrl, referrerUrl: current.referrerUrl,
        file: current.file, download, ...(reaction ? { reaction: current.reaction } : {}) };
      const frame = JSON.stringify({ sequence: ++sequence,
        type: status === 'queued' ? 'download.queued' : 'download.progress',
        occurred_at: new Date().toISOString(), data });
      for (const socket of sockets) socket.send(frame);
    },
    async close() {
      for (const socket of sockets) socket.terminate();
      await new Promise(resolve => websocket.close(resolve));
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    },
  };
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
}
