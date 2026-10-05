import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Disposable Chromium, real DOM/media events and production source modules.
// Desktop acknowledgements and close intents are in-memory; no live accounts.
// node tests/browser/mixed-gallery.mjs <playwright-core directory> <chromium executable>
const { chromium } = await import(pathToFileURL(path.resolve(process.argv[2], 'index.mjs')));
const root = path.resolve(import.meta.dirname, '../..');
const profile = JSON.parse(await fs.readFile(path.resolve(root, '../atlas-deviantart/browser/capture.json'), 'utf8'));
const gallery = profile.rules.find(rule => rule.gallery).gallery;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  response.setHeader('Cache-Control', 'no-store');
  if (url.pathname.startsWith('/media/')) {
    if (url.pathname.endsWith('.mp4')) { response.writeHead(204); response.end(); return; }
    response.setHeader('Content-Type', 'image/png'); response.end(png); return;
  }
  if (url.pathname.startsWith('/src/')) {
    const file = path.resolve(root, `.${url.pathname}`);
    if (!file.startsWith(`${root}${path.sep}`)) { response.writeHead(403); response.end(); return; }
    try { response.setHeader('Content-Type', 'text/javascript'); response.end(await fs.readFile(file)); }
    catch { response.writeHead(404); response.end(); }
    return;
  }
  response.setHeader('Content-Type', 'text/html');
  response.end(`<!doctype html><html><head><title>Mixed gallery regression</title>
    <style>body{margin:16px;background:#111;color:#eee;font:16px sans-serif}
    main{max-width:640px}.stage{position:relative;aspect-ratio:3/2}
    .stage img,.stage video{position:absolute;width:100%;height:100%;inset:0}
    .stage video{height:84%;top:8%}
    section button img{width:30px;height:30px}section{display:flex;flex-wrap:wrap}
    .atlas-collection-progress{display:block}.atlas-collection-progress[hidden]{display:none}</style>
    </head><body><main><div class="stage"></div><section aria-label="Gallery items"></section></main></body></html>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ executablePath: process.argv[3], headless: true });
try {
  const page = await browser.newPage();
  // Gallery scope intentionally rejects nonstandard ports. Keep a realistic
  // synthetic origin while serving every request from our loopback fixture.
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    assert.equal(url.origin, 'https://gallery.example.test');
    const response = await fetch(`http://127.0.0.1:${server.address().port}${url.pathname}${url.search}`);
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers),
      body: Buffer.from(await response.arrayBuffer()) });
  });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const scenario of [
      { types: ['image', 'video', 'video', 'image'], start: 0 },
      { types: ['image', 'video', 'video', 'image'], start: 1 },
      { types: [...Array(50).fill('image'), 'video'], start: 20 },
    ]) {
      await page.goto(`https://gallery.example.test/post?file=${scenario.start + 1}`);
      const result = await page.evaluate(async ({ gallery, types, start }) => {
        const { resolveAssetBatchContext } = await import('/src/content/batch-providers/index.js');
        const { createGalleryReactionRuntime } = await import('/src/content/gallery-reaction-runtime.js');
        const { armCloseTabForReaction } = await import('/src/content/close-tab-reactions.js');
        const { createCollectionProgress } = await import('/src/content/collection-progress.js');
        const queued = []; const intents = []; const errors = []; const progress = [];
        const stage = document.querySelector('.stage');
        const strip = document.querySelector('main section');
        strip.append('All Images');
        const image = document.createElement('img');
        stage.append(image);
        let current;
        let currentElement;
        const sources = types.map((type, index) => `${window.location.origin}/media/item-${index}.${type === 'video' ? 'mp4' : 'png'}`);
        const buttons = types.map((_type, index) => {
          const button = document.createElement('button');
          button.ariaLabel = `Select item ${index + 1}`;
          const thumbnail = document.createElement('img');
          thumbnail.src = `/media/thumb-${index}.png`;
          button.append(thumbnail); strip.append(button);
          button.addEventListener('click', () => select(index));
          return button;
        });
        function select(index) {
          current = index;
          window.history.replaceState(null, '', `?file=${index + 1}`);
          buttons.forEach((button, position) => button.setAttribute('aria-selected', String(position === index)));
          stage.querySelector('video')?.remove();
          // Retain the connected, visible image beneath the video to exercise
          // the former bound-image fast path and poster substitution defect.
          image.src = types[index] === 'image' ? sources[index] : '/media/poster.png';
          currentElement = image;
          if (types[index] === 'video') {
            const video = document.createElement('video');
            video.src = sources[index]; video.preload = 'none'; video.controls = true;
            stage.append(video); currentElement = video;
          }
        }
        select(start);
        const panelParent = document.createElement('div'); document.body.append(panelParent);
        const display = createCollectionProgress(panelParent, { onCancel() {}, onDismiss() {}, onRetry() {} });
        globalThis.chrome = { runtime: { sendMessage(message, callback) {
          let payload = {};
          if (message.type === 'atlas-extension.asset-reaction-batch') {
            queued.push(...message.items);
            payload = { items: message.items.map(item => ({ asset_url: item.asset.source, download: { requested: true, status: 'queued' } })) };
          } else if (message.type === 'atlas-extension.download-close-intent') {
            intents.push({ ...message, phase: progress.at(-1).phase, current }); payload = { closed: true };
          } else if (message.type !== 'atlas-extension.gallery-segment-acknowledged') throw new Error('Unexpected transport request');
          callback({ ok: true, payload });
        } } };
        const runtime = createGalleryReactionRuntime({ getOverlay: () => ({
          showCollectionProgress(state) { progress.push(state); display.show(state); },
          showError(message) { errors.push(message); }, clearError() {},
        }), updateBadgeState() {}, applyAccepted() {},
        closeAfterReaction: payload => armCloseTabForReaction(payload, {
          loadModeForSiteDomain: async () => 'after_queue', locationContext: window.location,
        }) });
        const batchContext = resolveAssetBatchContext({ element: currentElement, documentContext: document,
          locationContext: window.location, pageContext: { provider: 'deviantart', url: window.location.href, gallery } });
        if (!batchContext) throw new Error('Synthetic gallery did not resolve');
        await runtime.react(() => runtime.start({ id: 'synthetic', batchContext, documentContext: document,
          locationContext: window.location, event: { type: 'like' }, downloadAction: 'download' }));
        return { types: queued.map(item => item.asset.type), sourcesMatch: queued.every((item, index) => item.asset.source === sources[index]),
          errors, phase: progress.at(-1).phase, intents: intents.map(intent => ({ mode: intent.mode,
            count: intent.assetUrls.length, phase: intent.phase, restored: intent.current === start })),
          progressVisible: !panelParent.firstElementChild.hidden,
          overflow: document.documentElement.scrollWidth > window.innerWidth };
      }, { gallery, ...scenario });
      assert.deepEqual(result.types, scenario.types);
      assert.equal(result.sourcesMatch, true);
      assert.deepEqual(result.errors, []);
      assert.equal(result.phase, 'completed');
      assert.deepEqual(result.intents, [{ mode: 'after_queue', count: scenario.types.length, phase: 'completed', restored: true }]);
      assert.equal(result.progressVisible, true);
      assert.equal(result.overflow, false);
      console.log(`PASS: ${scenario.types.length} mixed items, start ${scenario.start + 1}, width ${width}; restored and close intent armed after completion.`);
    }
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
