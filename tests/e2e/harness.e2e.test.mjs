import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, before, test } from 'node:test';

import { e2eSettings, launchAtlas } from './harness/atlas.mjs';

// Harness smoke tests: each capability a new feature test relies on.
const settings = e2eSettings();
let atlas;

before(async () => { atlas = await launchAtlas({ name: 'harness', settings }); });
after(async () => { await atlas?.close(); });

test('the service worker of the built extension is reachable', async () => {
  const manifest = await atlas.evaluateInWorker(() => globalThis.chrome.runtime.getManifest());
  assert.equal(manifest.name, 'Atlas Extension');
  assert.match(atlas.extensionId, /^[a-p]{32}$/);
});

test('pairing goes through the Desktop target with the extension identity', async () => {
  await atlas.pair();
  const pairing = atlas.desktop.log.find(entry => entry.path === '/v1/pairings');
  assert.equal(pairing.method, 'POST');
  assert.equal(pairing.body.client_name, 'Atlas Extension');
  assert.equal(pairing.body.expected_channel, 'dev');
  assert.equal(pairing.body.extension_origin, `chrome-extension://${atlas.extensionId}`);
  assert.ok(atlas.desktop.log.some(entry => entry.path === '/v1/hello'));
});

test('popup and options pages open by chrome-extension:// URL and reflect the Desktop connection', async () => {
  const popup = await atlas.openPopup();
  await popup.locator('#atlas-popup-pairing-status').filter({ hasText: 'Paired' }).waitFor();
  await popup.locator('#atlas-popup-connection-status').filter({ hasText: 'Connected' }).waitFor();
  await popup.close();
  const options = await atlas.openOptions();
  assert.equal(await options.title(), 'Atlas Extension Options');
  await options.locator('#app *').first().waitFor();
  await options.close();
});

test('content-script UI mounts on fixture pages', async () => {
  const page = await atlas.context.newPage();
  await page.goto(atlas.fixtures.url('/drop-zone.html'));
  await page.locator('#atlas-extension-asset-overlay').waitFor({ state: 'attached' });
  await page.locator('[data-atlas-asset-badge="true"]').first().waitFor();
  await page.close();
});

test('browser-level downloads can be asserted', async () => {
  const page = await atlas.context.newPage();
  await page.goto(atlas.fixtures.url('/download.html'));
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#browser-download')]);
  assert.equal(download.suggestedFilename(), 'atlas-brief.pdf');
  const saved = path.join(atlas.root, 'saved-download.pdf');
  await download.saveAs(saved);
  assert.match(await fs.readFile(saved, 'utf8'), /^%PDF-1\.4/);
  await page.close();
});
