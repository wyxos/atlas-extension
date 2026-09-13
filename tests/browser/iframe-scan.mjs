import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Run against a development build with a disposable browser profile.
// node tests/browser/iframe-scan.mjs <playwright-core directory> <chromium executable>
const { chromium } = await import(pathToFileURL(path.resolve(process.argv[2], 'index.mjs')));
const root = path.resolve(import.meta.dirname, '../..');
const extension = path.join(root, 'dist/iframe-scan-dev');
const marker = JSON.parse(await fs.readFile(path.join(extension, 'atlas-desktop-compatibility.json'), 'utf8'));
assert.equal(marker.channel, 'dev');
const media = '<button onclick="const v=document.createElement(\'video\');v.src=\'/late.mp4\';v.controls=true;v.style=\'width:100%;height:240px\';document.body.append(v);this.remove()">Show video</button>';
const server = http.createServer((request, response) => {
  response.setHeader('Content-Type', 'text/html');
  const port = server.address().port;
  if (request.url === '/late.mp4') { response.writeHead(204); response.end(); return; }
  if (request.url === '/player') { response.end(`<body style="margin:0">${media}</body>`); return; }
  response.end(`<body style="margin:0;background:#10283f;color:white;font:16px sans-serif"><h1>Iframe media fixture</h1>
    <iframe title="same" style="width:100%;height:290px;border:0" src="/player"></iframe>
    <iframe title="cross" style="width:100%;height:290px;border:0" src="http://localhost:${port}/player"></iframe>
    <iframe title="blank" style="width:100%;height:290px;border:0" srcdoc="${media.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"></iframe>
    </body>`);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const context = await chromium.launchPersistentContext('', {
  executablePath: process.argv[3], headless: true,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
context.setDefaultTimeout(15000);
console.log('Development browser started.');
try {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  console.log('Extension worker loaded.');
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  console.log('Fixture and popup loaded.');
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.bringToFront();
    if (width === 1280) {
      for (const title of ['same', 'cross', 'blank']) {
        const frame = page.frameLocator(`iframe[title="${title}"]`);
        await frame.getByRole('button', { name: 'Show video' }).click();
      }
    }
    await popup.evaluate(() => document.querySelector('#atlas-popup-scan').click());
    console.log(`Scan requested at width ${width}.`);
    await popup.locator('#atlas-popup-action-status').filter({ hasText: /^Scan complete$/ }).waitFor();
    for (const frame of page.frames().filter((frame) => frame !== page.mainFrame())) {
      await frame.locator('[data-atlas-extension-badge-host]').waitFor();
      assert.equal(await frame.locator('#atlas-extension-tab-counter').count(), 0);
      assert.equal(await frame.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    }
    await page.screenshot({ path: path.join(extension, `iframe-${width}.png`), fullPage: true });
  }
  assert.deepEqual(errors, []);
  const interests = await worker.evaluate(async () => (await globalThis.chrome.storage.session.get('atlasContentInterestsV1')).atlasContentInterestsV1);
  assert.ok(interests.some((record) => record.frames.length >= 4));
  console.log('PASS: late videos in same-origin, cross-origin and srcdoc frames; confirmed popup scan; frame subscriptions; desktop/narrow layout; no page errors.');
} finally {
  await context.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
