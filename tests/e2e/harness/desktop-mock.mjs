import { randomBytes, randomUUID } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import fs from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { WebSocketServer } from 'ws';

import { renderMockLog } from './mock-log-page.mjs';

// A local stand-in for Atlas Desktop's extension API, derived from the
// atlas-desktop sources (not invented). Each handler cites its origin:
//   src/features/api/endpoints.json                  endpoint list, methods, access
//   src-tauri/src/extension_contract.rs              envelopes, HelloData, CAPABILITIES, PairingRequest
//   src-tauri/src/extension_api.rs (hello)           hello payload, pairing_required: true
//   src-tauri/src/extension_api/commands.rs          ok()/fail(), authenticate() -> 401 PAIRING_REQUIRED
//   src-tauri/src/extension_api/pairing.rs           201 IssuedExtensionClient
//   src-tauri/src/extension_clients.rs               client_token "atx_" prefix
//   src-tauri/src/extension_api/mutations.rs         POST /reactions: Idempotency-Key, 201, REACTION_FAILED
//   src-tauri/src/extension_assets.rs                ReactionRequest / AssetMetadata fields
//   src-tauri/src/extension_assets/reaction.rs       validate_reaction / download_action / http URLs, response shape
//   src-tauri/src/extension_assets/file_persistence.rs  listing_metadata persisted for a browser file
//   src-tauri/src/extension_assets/status.rs         POST /assets/status payload
//   src-tauri/src/extension_assets/download.rs       download.queued / download.progress frames
//   src-tauri/src/extension_api/events.rs            tickets (201) and websocket_url, "ready" frame
//   src-tauri/src/extension_bridge.rs                ExtensionEvent { sequence, type, occurred_at, data }
//   src-tauri/src/downloads/model.rs (source_type)   video/iframe asset_type -> "yt-dlp", else "direct"
//   src-tauri/src/downloads/engine.rs + engine/ytdlp.rs  yt-dlp transfer URL: top_page_url -> referrer_url -> url
// Native-only behavior (approval dialogs, MariaDB persistence, provider
// plugins, VPN routing, managed storage swaps) is not modeled.

export const desktopCapabilities = Object.freeze([
  'runtime-policy', 'widget-placement', 'batch-provider-preference', 'close-tab-mode', 'download-events',
  'event-diagnostics', 'extension-diagnostics-v1', 'extension-diagnostics-reasons-v1',
  'extension-diagnostics-cookie-flags-v1', 'asset-status', 'reactions', 'reaction-batches', 'file-delete',
  'file-open', 'asset-match-rules', 'browser-provider-resolution-v1', 'browser-container-actions-v1',
  'browser-authenticated-download-v1',
]);
const reactionTypes = new Set(['love', 'like', 'funny', 'blacklist']);
const downloadActions = new Set(['queue', 'skip', 'force']);
// AssetMetadata in extension_assets.rs has no deny_unknown_fields: unknown
// keys are accepted and dropped. The mock records both views.
const persistedMetadataFields = ['asset_type', 'top_page_url', 'resolution', 'width', 'height'];

export async function startDesktopMock({ runtimeId = randomBytes(12).toString('hex'), downloadsDir, autoApprovePairing = true,
  downloadDelayMs = 150 } = {}) {
  const events = new EventEmitter();
  const sockets = new Set();
  const tickets = new Map();
  const clients = new Map();
  const idempotency = new Map();
  const files = new Map();
  const log = [];
  const unexpected = [];
  let sequence = 0;
  let nextFileId = 100;
  let origin;
  downloadsDir ??= await fs.mkdtemp(path.join((await import('node:os')).tmpdir(), 'atlas-e2e-downloads-'));
  await fs.mkdir(downloadsDir, { recursive: true });

  const server = createServer(async (request, response) => {
    const url = new URL(request.url, origin);
    const apiPath = url.pathname.replace(/^\/api\/v1(?=\/)/, '/v1');
    const send = (status, envelope) => {
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(envelope));
    };
    const ok = (status, data) => send(status, { ok: true, request_id: randomUUID(), data });
    const fail = (status, code, message, retryable = false) =>
      send(status, { ok: false, request_id: randomUUID(), error: { code, message, retryable } });
    try {
      if (apiPath.startsWith('/__mock')) return void await mockControl(url, response);
      const body = await readJson(request);
      const entry = { at: new Date().toISOString(), method: request.method, path: apiPath,
        headers: pickHeaders(request.headers), body };
      if (apiPath !== '/v1/events') log.push(entry);
      events.emit('request', entry);

      if (request.method === 'GET' && apiPath === '/v1/hello') {
        return ok(200, { protocol_version: 1, app: { version: 'mock', channel: 'dev', runtime_id: runtimeId },
          pairing_required: true, capabilities: desktopCapabilities });
      }
      if (request.method === 'POST' && apiPath === '/v1/pairings') {
        const required = ['client_name', 'browser', 'extension_version', 'expected_channel'];
        if (!body || required.some(key => typeof body[key] !== 'string')) return fail(400, 'INVALID_PAIRING', 'The pairing request is invalid.');
        if (body.expected_channel !== 'dev') return fail(409, 'CHANNEL_MISMATCH', 'Atlas Desktop dev is running.');
        if (!autoApprovePairing) return fail(403, 'PAIRING_DENIED', 'Pairing was denied.');
        const client = { client_id: randomUUID(), client_token: `atx_${randomBytes(24).toString('base64url')}` };
        clients.set(client.client_id, { ...client, origin: body.extension_origin ?? null });
        events.emit('paired', client);
        return ok(201, client);
      }
      const clientId = request.headers['x-atlas-client-id'];
      const token = String(request.headers.authorization ?? '').replace(/^Bearer /, '');
      if (!clients.has(clientId) || clients.get(clientId).client_token !== token) {
        return fail(401, 'PAIRING_REQUIRED', 'Pair this extension with Atlas first.');
      }
      if (request.method === 'GET' && apiPath === '/v1/runtime-policy') {
        return ok(200, { revision: 1, settings: { schemaVersion: 1, settings: {
          assetSourcePreferences: { version: 3, domains: [], profiles: [] },
          closeTabPreferences: { version: 1, modesBySiteDomain: {} },
        } } });
      }
      if (request.method === 'POST' && apiPath === '/v1/browser/resolve') {
        return ok(200, { pages: (body?.pages ?? []).map(({ url: pageUrl }) => ({ url: pageUrl, canonicalPage: pageUrl,
          provider: null, identity: null, gallery: null })) });
      }
      if (request.method === 'POST' && apiPath === '/v1/assets/status') {
        const assets = {};
        for (const assetUrl of body?.asset_urls ?? []) {
          const file = [...files.values()].find(record => record.url === assetUrl);
          if (file) assets[assetUrl] = statusPayload(file);
        }
        return ok(200, { assets, matches: {}, referrers: {} });
      }
      if (request.method === 'POST' && apiPath === '/v1/events/tickets') {
        const ticket = randomBytes(16).toString('hex');
        tickets.set(ticket, clientId);
        return ok(201, { ticket, websocket_url: `${origin.replace('http:', 'ws:')}/v1/events?ticket=${ticket}` });
      }
      if (request.method === 'POST' && apiPath === '/v1/diagnostics/reaction-failures') {
        return ok(200, { recorded: true });
      }
      if (request.method === 'POST' && apiPath === '/v1/reactions') {
        const key = request.headers['idempotency-key'];
        if (!key) return fail(400, 'IDEMPOTENCY_REQUIRED', 'An Idempotency-Key header is required.');
        if (idempotency.has(key)) return ok(201, idempotency.get(key));
        const error = validateReaction(body);
        if (error) return fail(400, 'REACTION_FAILED', error);
        const { file, downloadRequested } = applyReaction(body);
        const data = reactionResponse(file, body, downloadRequested);
        idempotency.set(key, data);
        entry.response = data;
        events.emit('reaction', { body, file, data });
        if (downloadRequested) void simulateDownload(file, body);
        return ok(201, data);
      }
      unexpected.push(`${request.method} ${apiPath}`);
      return fail(404, 'NOT_FOUND', 'The Atlas API endpoint was not found.');
    } catch (error) {
      unexpected.push(error.message);
      return fail(500, 'MOCK_FAILURE', error.message, true);
    }
  });

  const websocket = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, origin);
    const ticket = url.searchParams.get('ticket');
    if (!/^\/(api\/)?v1\/events$/.test(url.pathname) || !tickets.delete(ticket)) {
      socket.destroy();
      return;
    }
    websocket.handleUpgrade(request, socket, head, client => {
      sockets.add(client);
      client.on('close', () => sockets.delete(client));
      client.send(JSON.stringify({ type: 'ready', sequence }));
      events.emit('connected');
    });
  });

  function validateReaction(body) {
    if (!body || typeof body.asset_url !== 'string' || typeof body.type !== 'string') return 'The reaction request is invalid.';
    if (!httpUrl(body.asset_url)) return 'Asset URL must use HTTP or HTTPS.';
    if (body.referrer_url != null && !httpUrl(body.referrer_url)) return 'Referrer URL must use HTTP or HTTPS.';
    if (body.metadata?.top_page_url != null && !httpUrl(body.metadata.top_page_url)) return 'Top-level page URL is invalid.';
    if (!reactionTypes.has(body.type)) return 'The reaction type is not supported.';
    if (!downloadActions.has(body.download_action ?? 'queue')) return 'The download action is not supported.';
    if ((body.cookies?.length ?? 0) > 300) return 'A request may contain at most 300 cookies.';
    return null;
  }

  function applyReaction(body) {
    let file = [...files.values()].find(record => record.url === body.asset_url);
    const metadata = body.metadata ?? {};
    const listingMetadata = { page_url: body.referrer_url ?? null,
      extension: Object.fromEntries(persistedMetadataFields.map(field => [field, metadata[field] ?? null])) };
    if (!file) {
      file = { id: ++nextFileId, url: body.asset_url, referrer_url: body.referrer_url ?? null, preview_url: null,
        source: body.source || new URL(body.asset_url).host, filename: randomBasename(), downloaded_at: null,
        listing_metadata: listingMetadata, download: null, reaction: null, blacklisted_at: null, received_metadata: metadata };
      files.set(file.id, file);
    } else {
      if (body.referrer_url) file.referrer_url = body.referrer_url;
      file.listing_metadata = listingMetadata;
      file.received_metadata = metadata;
    }
    const action = body.download_action ?? 'queue';
    let downloadRequested = false;
    if (body.type === 'blacklist') {
      file.blacklisted_at = new Date().toISOString();
      file.reaction = null;
    } else {
      file.reaction = body.type;
      downloadRequested = action !== 'skip' && (action === 'force' || !file.downloaded_at);
    }
    if (downloadRequested) file.download = { status: 'queued', progress_percent: 0, transfer_id: file.id + 400, generation: 1 };
    return { file, downloadRequested };
  }

  function reactionResponse(file, body, downloadRequested) {
    return {
      asset_url: body.asset_url,
      file: { id: file.id, url: file.url, referrer_url: file.referrer_url },
      reaction: body.type === 'blacklist' ? null : { type: body.type },
      blacklisted_at: body.type === 'blacklist' ? file.blacklisted_at : null,
      download: { requested: downloadRequested, file_id: file.id, status: downloadRequested ? 'queued' : null,
        progress_percent: downloadRequested ? 0 : null, downloaded_at: null, error: null, error_code: null,
        failure_stage: null, retryable: false, retry_disposition: null, transfer_id: null, attempt: null, generation: null },
    };
  }

  function statusPayload(file) {
    return { file: { id: file.id, url: file.url, preview_url: file.preview_url, referrer_url: file.referrer_url },
      reaction: file.reaction, blacklisted_at: file.blacklisted_at, download: downloadPayload(file) };
  }

  function downloadPayload(file) {
    const download = file.download ?? {};
    return { requested: ['queued', 'downloading'].includes(download.status), file_id: file.id,
      status: download.status ?? null, progress_percent: download.progress_percent ?? null,
      downloaded_at: file.downloaded_at, error: download.error ?? null, error_code: download.error_code ?? null,
      failure_stage: null, retryable: false, retry_disposition: null, transfer_id: download.transfer_id ?? null,
      attempt: 1, generation: download.generation ?? null };
  }

  // Stand-in for Desktop's download engine: fetch the asset like a plain
  // HTTP client and store it under a 40-character basename
  // (docs/MANAGED_DOWNLOAD_STORAGE.md), publishing the same frames.
  // Desktop's download routing, recorded on the file as `transfer`. The mock
  // cannot run yt-dlp; it always fetches asset_url (Desktop's native fallback).
  function transferFor(file, metadata = {}) {
    const assetType = String(metadata.asset_type ?? '').toLowerCase();
    const sourceType = ['video', 'iframe'].includes(assetType) ? 'yt-dlp' : 'direct';
    const topPage = assetType === 'video' ? httpPage(metadata.top_page_url) : null;
    return { source_type: sourceType, url: sourceType === 'yt-dlp' ? topPage ?? file.referrer_url ?? file.url : file.url };
  }

  async function simulateDownload(file, body) {
    file.transfer = transferFor(file, body.metadata);
    publish('download.queued', file);
    await delay(downloadDelayMs);
    file.download = { ...file.download, status: 'downloading', progress_percent: 50 };
    publish('download.progress', file);
    try {
      const headers = body.user_agent ? { 'User-Agent': body.user_agent } : {};
      const response = await fetch(file.url, { headers });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
      const extension = extensionFor(contentType, file.url);
      const stored = path.join(downloadsDir, `${file.filename}${extension}`);
      await fs.writeFile(stored, bytes);
      await delay(downloadDelayMs);
      file.downloaded_at = new Date().toISOString();
      file.stored = { path: stored, bytes: bytes.length, content_type: contentType };
      file.download = { ...file.download, status: 'completed', progress_percent: 100 };
    } catch (error) {
      file.download = { ...file.download, status: 'failed', error: error.message, error_code: 'DOWNLOAD_FAILED' };
    }
    publish('download.progress', file);
    events.emit('downloaded', file);
  }

  function publish(type, file) {
    const frame = { sequence: ++sequence, type, occurred_at: new Date().toISOString(), data: {
      assetUrl: file.url, referrerUrl: file.referrer_url,
      file: { id: file.id, url: file.url, referrer_url: file.referrer_url, preview_url: file.preview_url },
      reaction: file.reaction ? { type: file.reaction } : null, download: downloadPayload(file) } };
    for (const socket of sockets) socket.send(JSON.stringify(frame));
  }

  async function mockControl(url, response) {
    if (url.pathname.endsWith('/state')) {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(snapshot(), null, 2));
      return;
    }
    const fileMatch = /\/__mock\/files\/(\d+)$/.exec(url.pathname);
    const file = fileMatch ? files.get(Number(fileMatch[1])) : null;
    if (file?.stored) {
      response.writeHead(200, { 'Content-Type': file.stored.content_type });
      response.end(await fs.readFile(file.stored.path));
      return;
    }
    if (url.pathname === '/__mock' || url.pathname === '/__mock/') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(renderMockLog(snapshot()));
      return;
    }
    response.writeHead(404);
    response.end();
  }

  function snapshot() {
    return {
      runtimeId, downloadsDir,
      requests: log.map(entry => ({ ...entry, headers: { ...entry.headers, authorization: entry.headers.authorization ? 'Bearer [redacted]' : undefined } })),
      files: [...files.values()].map(file => ({ ...file })),
      unexpected: [...unexpected],
    };
  }

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin, port: server.address().port, runtimeId, downloadsDir, log, files, unexpected,
    snapshot,
    reactions: () => log.filter(entry => entry.path === '/v1/reactions').map(entry => entry.body),
    connected: () => sockets.size ? Promise.resolve() : once(events, 'connected'),
    nextReaction: () => once(events, 'reaction').then(([value]) => value),
    nextDownload: (predicate = () => true) => new Promise(resolve => {
      const listener = file => { if (predicate(file)) { events.off('downloaded', listener); resolve(file); } };
      events.on('downloaded', listener);
    }),
    async close() {
      for (const socket of sockets) socket.terminate();
      await new Promise(resolve => websocket.close(resolve));
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    },
  };
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString());
}

function pickHeaders(headers) {
  return Object.fromEntries(['authorization', 'x-atlas-client-id', 'idempotency-key', 'x-atlas-request-id', 'origin', 'content-type']
    .filter(name => headers[name] !== undefined).map(name => [name, headers[name]]));
}

function httpUrl(value) {
  try {
    const url = new URL(String(value).trim());
    return ['http:', 'https:'].includes(url.protocol) && url.hostname !== '';
  } catch {
    return false;
  }
}

function randomBasename() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return [...randomBytes(40)].map(byte => alphabet[byte % alphabet.length]).join('');
}

function extensionFor(contentType, url) {
  const known = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp',
    'image/svg+xml': '.svg', 'application/pdf': '.pdf', 'text/html': '.html', 'video/webm': '.webm', 'video/mp4': '.mp4',
    'audio/ogg': '.ogg', 'audio/mpeg': '.mp3' };
  const fromType = known[contentType.split(';')[0].trim()];
  return fromType ?? (path.extname(new URL(url).pathname) || '.bin');
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function httpPage(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value.trim());
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? value.trim() : null;
  } catch {
    return null;
  }
}
