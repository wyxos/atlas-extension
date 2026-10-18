import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, before, test } from 'node:test';

import { e2eSettings, launchAtlas } from './harness/atlas.mjs';
import { startDrag, wait } from './harness/visual.mjs';

const settings = e2eSettings();
const { pause } = settings;
const fixturesDir = path.resolve(import.meta.dirname, 'fixtures');
let atlas;
let page;
let pageUrl;

before(async () => {
  atlas = await launchAtlas({ name: 'drop-zone', settings });
  await atlas.pair();
  page = await atlas.context.newPage();
  pageUrl = atlas.fixtures.url('/drop-zone.html');
  await page.goto(pageUrl);
  // The content script mounts after the page's DOM-mutation window.
  await page.locator('#atlas-extension-asset-overlay').waitFor({ state: 'attached' });
  await wait(page, pause);
});

after(async () => {
  if (!atlas) return;
  if (page && settings.artifactDir) {
    if (atlas.desktop.kind === 'mock') {
      // Finish the recording on the Desktop mock's capture log.
      await page.goto(`${atlas.desktop.origin}/__mock`);
      await wait(page, pause * 2);
      await atlas.screenshot(page, 'screenshots/03-captured-metadata.png');
      await page.screenshot({ path: path.join(settings.artifactDir, 'screenshots/03-captured-metadata-full.png'), fullPage: true });
      await wait(page, pause * 3);
    }
    const video = page.video();
    await page.close();
    await video?.saveAs(path.join(settings.artifactDir, 'drop-zone.webm'));
    await fs.writeFile(path.join(settings.artifactDir, 'desktop-mock-state.json'), JSON.stringify(atlas.desktop.snapshot(), null, 2));
  }
  await atlas.close();
});

const zone = () => page.locator('[data-atlas-drop-zone]');
const toast = () => page.locator('[data-atlas-drop-zone-toast]');

async function dropOnZone(selector) {
  const reaction = atlas.desktop.nextReaction();
  const drag = await startDrag(page, page.locator(selector), { pause });
  await drag.moveTo({ x: 760, y: 360 });
  await assertZoneVisible();
  await drag.moveTo(zone());
  await drag.drop();
  const { body, data } = await reaction;
  return { body, data };
}

async function assertZoneVisible() {
  await zone().waitFor({ state: 'visible', timeout: 5000 });
}

async function assertZoneHidden() {
  await zone().waitFor({ state: 'hidden', timeout: 5000 });
}

test('drop zone is absent before a drag and appears with item details while an image is dragged', async () => {
  assert.equal(await zone().isVisible().catch(() => false), false);
  const drag = await startDrag(page, page.locator('#hero-image'), { pause });
  await drag.moveTo({ x: 760, y: 360 });
  await assertZoneVisible();
  assert.equal(await zone().getAttribute('data-atlas-drop-kind'), 'image');
  assert.match(await zone().textContent(), /Drop to save to Atlas.*Image.*mandelbrot\.png/);
  await drag.moveTo(zone());
  assert.match(await zone().getAttribute('class'), /is-over/);
  await atlas.screenshot(page, 'screenshots/01-drag-in-progress.png');
  // Release away from the zone: nothing is sent, the zone hides.
  const before = atlas.desktop.reactions().length;
  await drag.moveTo({ x: 760, y: 560 });
  await drag.drop();
  await assertZoneHidden();
  assert.equal(atlas.desktop.reactions().length, before);
});

test('dropping an image on the zone downloads it through Desktop with page and element metadata', async () => {
  const downloaded = atlas.desktop.nextDownload?.(file => file.url.endsWith('/media/mandelbrot.png'));
  const { body, data } = await dropOnZone('#hero-image');
  await assertZoneHidden();
  const asset = atlas.fixtures.url('/media/mandelbrot.png');
  assert.equal(body.asset_url, asset);
  assert.equal(body.type, 'like');
  assert.equal(body.referrer_url, pageUrl);
  assert.equal(body.source, '127.0.0.1');
  assert.equal(body.download_action, undefined);
  assert.deepEqual(body.metadata, {
    asset_type: 'image', resolution: '480x320', width: 480, height: 320,
    alt_text: 'Mandelbrot fractal in deep blue', capture_method: 'drop-zone', filename: 'mandelbrot.png',
    page_title: 'Atlas E2E · Moodboard fixture', page_url: pageUrl, title_text: 'Fractal study',
  });
  assert.equal(data.download.status, 'queued');
  await toast().filter({ hasText: 'Download queued in Atlas · mandelbrot.png' }).waitFor();
  await atlas.screenshot(page, 'screenshots/02-after-drop.png');
  if (downloaded) {
    const file = await downloaded;
    assert.equal(file.download.status, 'completed');
    assert.equal(file.stored.content_type, 'image/png');
    assert.match(path.basename(file.stored.path), /^[A-Za-z0-9]{40}\.png$/);
    assert.deepEqual(await fs.readFile(file.stored.path), await fs.readFile(path.join(fixturesDir, 'media/mandelbrot.png')));
  }
  await wait(page, pause);
});

test('dropping a file link downloads the linked file with link metadata', async () => {
  const downloaded = atlas.desktop.nextDownload?.(file => file.url.endsWith('/media/brief.pdf'));
  const { body } = await dropOnZone('#file-link');
  const asset = atlas.fixtures.url('/media/brief.pdf');
  assert.equal(body.asset_url, asset);
  assert.equal(body.referrer_url, pageUrl);
  assert.deepEqual(body.metadata, {
    asset_type: 'file', capture_method: 'drop-zone', element_url: asset, filename: 'brief.pdf',
    link_text: 'Download the project brief', page_title: 'Atlas E2E · Moodboard fixture', page_url: pageUrl,
    title_text: 'Project brief PDF',
  });
  if (downloaded) {
    const file = await downloaded;
    assert.equal(file.stored.content_type, 'application/pdf');
    assert.deepEqual(await fs.readFile(file.stored.path), await fs.readFile(path.join(fixturesDir, 'media/brief.pdf')));
  }
  await toast().filter({ hasText: 'brief.pdf' }).waitFor();
  await wait(page, pause);
});

test('dropping a page link sends a link item and an image inside a link keeps its anchor', async () => {
  const { body: link } = await dropOnZone('#page-link');
  assert.equal(link.asset_url, atlas.fixtures.url('/pages/about.html'));
  assert.equal(link.metadata.asset_type, 'link');
  assert.equal(link.metadata.link_text, 'About this board');
  assert.equal(link.metadata.filename, undefined);

  const { body: linked } = await dropOnZone('#pattern-image');
  assert.equal(linked.asset_url, atlas.fixtures.url('/media/test-pattern.png'));
  assert.equal(linked.metadata.asset_type, 'image');
  assert.equal(linked.metadata.alt_text, 'Broadcast test pattern');
  assert.equal(linked.metadata.element_url, atlas.fixtures.url('/pages/pattern-detail.html'));
});

test('Escape and leaving the window hide the drop zone without sending anything', async () => {
  const before = atlas.desktop.reactions().length;
  let drag = await startDrag(page, page.locator('#hero-image'), { pause });
  await drag.moveTo({ x: 760, y: 360 });
  await assertZoneVisible();
  await page.keyboard.press('Escape');
  await assertZoneHidden();
  await drag.drop();

  drag = await startDrag(page, page.locator('#hero-image'), { pause });
  await drag.moveTo({ x: 760, y: 360 });
  await assertZoneVisible();
  await drag.moveTo({ x: 0, y: 360 }, { steps: 10 });
  await page.evaluate(() => document.documentElement.dispatchEvent(new globalThis.DragEvent('dragleave',
    { bubbles: true, clientX: 0, clientY: 360, relatedTarget: null })));
  await assertZoneHidden();
  await drag.drop();
  assert.equal(atlas.desktop.reactions().length, before);
});

test('normal page drag and drop keeps working and is not captured by Atlas', async () => {
  const before = atlas.desktop.reactions().length;
  const drag = await startDrag(page, page.locator('#hero-image'), { pause });
  await drag.moveTo(page.locator('#page-drop-target'));
  await assertZoneVisible();
  await drag.drop();
  await assertZoneHidden();
  assert.deepEqual(await page.evaluate(() => window.pageDrops), [atlas.fixtures.url('/media/mandelbrot.png')]);
  await page.locator('#page-drop-target.received').waitFor();
  assert.equal(atlas.desktop.reactions().length, before);
  assert.deepEqual(atlas.desktop.unexpected, []);
  await wait(page, pause);
});
