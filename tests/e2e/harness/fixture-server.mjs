import fs from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';

const types = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.pdf': 'application/pdf',
  '.svg': 'image/svg+xml', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webm': 'video/webm', '.mp4': 'video/mp4', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg' };

// Serves tests/e2e/fixtures on its own loopback port (a separate origin from
// the Desktop API port).
export async function startFixtureServer(root = path.resolve(import.meta.dirname, '../fixtures')) {
  const requests = [];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    requests.push({ method: request.method, path: url.pathname, userAgent: request.headers['user-agent'] });
    const file = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
    if (!file.startsWith(root)) { response.writeHead(403); response.end(); return; }
    try {
      const body = await fs.readFile(file);
      response.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin, requests, url: (pathname) => new URL(pathname, origin).href,
    close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }),
  };
}
