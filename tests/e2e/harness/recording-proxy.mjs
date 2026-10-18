import { EventEmitter, once } from 'node:events';
import { createServer, request as httpRequest } from 'node:http';

// Records every request the extension sends to a real Atlas Desktop dev
// instance, so the same assertions run against the mock and the native app.
export async function startRecordingProxy({ upstream, runtimeId }) {
  const target = new URL(upstream);
  if (target.hostname !== '127.0.0.1' || target.protocol !== 'http:') {
    throw new Error('ATLAS_E2E_DESKTOP_URL must be an http://127.0.0.1:<port> Atlas Desktop dev instance.');
  }
  const events = new EventEmitter();
  const log = [];
  const server = createServer(async (incoming, outgoing) => {
    const chunks = [];
    for await (const chunk of incoming) chunks.push(chunk);
    const raw = Buffer.concat(chunks);
    const path = incoming.url.replace(/^\/api\/v1(?=\/)/, '/v1');
    const entry = { at: new Date().toISOString(), method: incoming.method, path,
      body: raw.length ? JSON.parse(raw.toString()) : undefined };
    log.push(entry);
    const forward = httpRequest({ host: target.hostname, port: target.port, method: incoming.method, path: incoming.url,
      headers: { ...incoming.headers, host: target.host } }, response => {
      const body = [];
      response.on('data', chunk => body.push(chunk));
      response.on('end', () => {
        const buffer = Buffer.concat(body);
        try { entry.response = JSON.parse(buffer.toString()).data; } catch { /* non-JSON */ }
        outgoing.writeHead(response.statusCode, response.headers);
        outgoing.end(buffer);
        if (path === '/v1/reactions') events.emit('reaction', { body: entry.body, data: entry.response });
      });
    });
    forward.on('error', error => { outgoing.writeHead(502); outgoing.end(error.message); });
    forward.end(raw);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    kind: 'real', origin, port: server.address().port, runtimeId, log, unexpected: [],
    reactions: () => log.filter(entry => entry.path === '/v1/reactions').map(entry => entry.body),
    connected: () => Promise.resolve(),
    nextReaction: () => once(events, 'reaction').then(([value]) => value),
    nextDownload: null,
    snapshot: () => ({ runtimeId, requests: log, files: [], unexpected: [] }),
    close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }),
  };
}
