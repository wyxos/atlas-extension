import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, before, test } from 'node:test';

import { e2eSettings, launchAtlas } from './harness/atlas.mjs';
import { dropOnZone, dropToast, dropZone, reactionPicker } from './harness/drop-zone.mjs';
import { wait } from './harness/visual.mjs';

const settings = e2eSettings();
const { pause } = settings;
const fixturesDir = path.resolve(import.meta.dirname, 'fixtures');
let atlas;
let page;
let pageUrl;

before(async () => {
  atlas = await launchAtlas({ name: 'drop-zone-media', settings });
  await atlas.pair();
  page = await atlas.context.newPage();
  pageUrl = atlas.fixtures.url('/media.html');
  await page.goto(pageUrl);
  await page.locator('#atlas-extension-asset-overlay').waitFor({ state: 'attached' });
  // Metadata (duration, dimensions) must be loaded before it can be captured.
  await page.waitForFunction(() => ['plain-video', 'covered-video', 'audio-el']
    .every(id => document.getElementById(id).readyState >= 1)
    && document.getElementById('stream-video').dataset.stream
    && document.getElementById('stream-video').currentSrc.startsWith('blob:'));
  await wait(page, pause);
});

after(async () => {
  if (!atlas) return;
  if (page && settings.artifactDir) {
    if (atlas.desktop.kind === 'mock') {
      await page.goto(`${atlas.desktop.origin}/__mock`);
      await wait(page, pause * 2);
      await atlas.screenshot(page, 'screenshots/07-captured-media-metadata.png');
      await page.screenshot({ path: path.join(settings.artifactDir, 'screenshots/07-captured-media-metadata-full.png'), fullPage: true });
      await wait(page, pause * 3);
    }
    const video = page.video();
    await page.close();
    await video?.saveAs(path.join(settings.artifactDir, 'drop-zone-media.webm'));
    await fs.writeFile(path.join(settings.artifactDir, 'desktop-mock-state-media.json'), JSON.stringify(atlas.desktop.snapshot(), null, 2));
  }
  await atlas.close();
});

const mediaPage = () => ({ page_title: 'Atlas E2E · Media fixture', page_url: pageUrl, capture_method: 'drop-zone' });

async function storedFile(predicate) {
  return atlas.desktop.nextDownload ? atlas.desktop.nextDownload(predicate) : null;
}

test('dropping a video link and picking Love sends one Love reaction and downloads the video', async () => {
  const downloaded = storedFile(file => file.url.endsWith('/media/clip.mp4'));
  const before = atlas.desktop.reactions().length;
  const { body } = await dropOnZone(atlas, page, page.locator('#video-link'), {
    pick: 'love', pause,
    beforePick: async () => {
      assert.equal(await reactionPicker(page).getAttribute('data-default-reaction'), 'like');
      assert.equal(await reactionPicker(page).locator('button.atlas-static-icon').count(), 4);
      await atlas.screenshot(page, 'screenshots/04-reaction-picker.png');
      await reactionPicker(page).locator('button[data-reaction="love"]').hover();
      await wait(page, pause);
    },
  });
  assert.equal(body.type, 'love');
  assert.equal(body.asset_url, atlas.fixtures.url('/media/clip.mp4'));
  assert.equal(body.referrer_url, pageUrl);
  assert.deepEqual(body.metadata, { ...mediaPage(), asset_type: 'video', element_url: body.asset_url,
    filename: 'clip.mp4', link_text: 'Watch the clip (MP4)' });
  await dropToast(page).filter({ hasText: 'Download queued in Atlas · Love · clip.mp4' }).waitFor();
  await atlas.screenshot(page, 'screenshots/05-picked-love.png');
  assert.equal(atlas.desktop.reactions().length, before + 1, 'exactly one reaction request per drop');
  const file = await downloaded;
  if (file) {
    assert.equal(file.stored.content_type, 'video/mp4');
    assert.deepEqual(await fs.readFile(file.stored.path), await fs.readFile(path.join(fixturesDir, 'media/clip.mp4')));
  }
});

test('a <video><source> covered by a link overlay resolves the video underneath; the timeout saves Like', async () => {
  const before = atlas.desktop.reactions().length;
  const startedAt = Date.now();
  const { body } = await dropOnZone(atlas, page, page.locator('#video-overlay'), {
    pick: null, pause: 0,
    beforePick: async () => {
      await wait(page, 1500);
      await atlas.screenshot(page, 'screenshots/06-timeout-countdown.png');
      assert.equal(atlas.desktop.reactions().length, before, 'nothing is sent before the picker settles');
    },
  });
  const elapsed = Date.now() - startedAt;
  assert.ok(elapsed >= 3500, `default applied after the timeout (${elapsed} ms)`);
  assert.equal(body.type, 'like');
  assert.equal(body.asset_url, atlas.fixtures.url('/media/bars.webm'));
  assert.deepEqual(body.metadata, { ...mediaPage(), asset_type: 'video', duration: 3, element_url: atlas.fixtures.url('/pages/about.html'),
    filename: 'bars.webm', height: 180, mime_type: 'video/webm', resolution: '320x180', width: 320 });
  await reactionPicker(page).waitFor({ state: 'hidden' });
  await dropToast(page).filter({ hasText: 'Download queued in Atlas · Like · bars.webm' }).waitFor();
  await atlas.screenshot(page, 'screenshots/06b-timeout-default-like.png');
  await wait(page, pause);
});

test('Alt+drag on a plain <video> captures its source, duration, size and poster', async () => {
  const { body } = await dropOnZone(atlas, page, page.locator('#plain-video'), {
    alt: true, pick: 'funny', pause,
    beforeDrop: async () => {
      assert.equal(await dropZone(page).getAttribute('data-atlas-drop-kind'), 'video');
      await atlas.screenshot(page, 'screenshots/09-video-element-over-zone.png');
    },
  });
  assert.equal(body.type, 'funny');
  assert.equal(body.asset_url, atlas.fixtures.url('/media/clip.webm'));
  assert.deepEqual(body.metadata, { ...mediaPage(), asset_type: 'video', duration: 2, filename: 'clip.webm', height: 180,
    poster_url: atlas.fixtures.url('/media/poster.png'), resolution: '320x180', title_text: 'Test pattern clip', width: 320 });
  assert.equal(await page.locator('#plain-video').getAttribute('draggable'), null, 'temporary draggable is removed');
});

test('audio in a custom player (Alt+drag) and audio link are saved as audio; dismissing the picker saves Like', async () => {
  const downloaded = storedFile(file => file.url.endsWith('/media/tone.ogg'));
  const { body: element } = await dropOnZone(atlas, page, page.locator('#audio-player span'), { alt: true, pick: 'dismiss', pause });
  assert.equal(element.type, 'like');
  assert.equal(element.asset_url, atlas.fixtures.url('/media/tone.ogg'));
  assert.equal(element.metadata.asset_type, 'audio');
  assert.equal(element.metadata.title_text, 'Sine tone');
  assert.ok(Math.abs(element.metadata.duration - 2) < 0.1);
  assert.equal(element.metadata.resolution, undefined);
  await dropToast(page).filter({ hasText: 'Download queued in Atlas · Like · tone.ogg' }).waitFor();
  await atlas.screenshot(page, 'screenshots/10-audio-saved.png');
  const file = await downloaded;
  if (file) assert.equal(file.stored.content_type, 'audio/ogg');

  const { body: link } = await dropOnZone(atlas, page, page.locator('#audio-link'), { pick: 'like', pause });
  assert.equal(link.asset_url, atlas.fixtures.url('/media/tone.mp3'));
  assert.equal(link.metadata.asset_type, 'audio');
  assert.equal(link.metadata.filename, 'tone.mp3');
});

test('an existing reaction is the picker default and is kept on timeout', async () => {
  // clip.mp4 was saved as Love in the first test.
  const { body } = await dropOnZone(atlas, page, page.locator('#video-link'), {
    pick: null,
    beforePick: async () => {
      await page.locator('[data-atlas-drop-picker][data-default-reaction="love"]').waitFor();
      await reactionPicker(page).filter({ hasText: 'Already Love in Atlas' }).waitFor();
    },
  });
  assert.equal(body.type, 'love');
});

test('a MediaSource (blob:) video is saved as the canonical page URL through Desktop\'s yt-dlp path', async () => {
  const canonical = atlas.fixtures.url('/media.html?view=canonical');
  const downloaded = storedFile(file => file.url === canonical);
  const { body } = await dropOnZone(atlas, page, page.locator('#stream-video'), {
    alt: true, pick: 'like', pause,
    beforeDrop: async () => {
      assert.equal(await dropZone(page).getAttribute('data-atlas-drop-state'), 'stream-fallback');
      assert.match(await dropZone(page).textContent(), /Drop to save the page video.*Streamed video · Atlas saves it from 127\.0\.0\.1 via yt-dlp/);
      await atlas.screenshot(page, 'screenshots/11-stream-fallback-over-zone.png');
    },
  });
  assert.equal(await page.locator('#stream-video').getAttribute('data-stream'), 'mse');
  assert.equal(body.type, 'like');
  assert.equal(body.asset_url, canonical, 'canonical link wins over location.href');
  assert.equal(body.referrer_url, pageUrl, 'Desktop starts yt-dlp at the real page');
  const { duration, ...metadata } = body.metadata;
  assert.ok(Math.abs(duration - 3) < 0.1, `MediaSource duration (${duration})`);
  assert.deepEqual(metadata, { ...mediaPage(), asset_type: 'video', height: 180, resolution: '320x180',
    stream_fallback: true, title_text: 'Streamed bars', width: 320 });
  await dropToast(page).filter({ hasText: 'Download queued in Atlas · Like · Streamed bars' }).waitFor();
  await atlas.screenshot(page, 'screenshots/12-stream-fallback-saved.png');
  const file = await downloaded;
  if (file) assert.deepEqual(file.transfer, { source_type: 'yt-dlp', url: pageUrl });
  assert.deepEqual(atlas.desktop.unexpected, []);
});

test('an overlay above a player iframe saves the embed page as a video', async () => {
  const embed = atlas.fixtures.url('/pages/player.html');
  const downloaded = storedFile(file => file.url === embed);
  const { body } = await dropOnZone(atlas, page, page.locator('#frame-overlay'), { pick: 'love', pause });
  assert.equal(body.asset_url, embed);
  assert.equal(body.referrer_url, embed);
  assert.deepEqual(body.metadata, { ...mediaPage(), asset_type: 'video', element_url: atlas.fixtures.url('/pages/about.html'),
    embed_url: embed, stream_fallback: true, title_text: 'Bars player' });
  await dropToast(page).filter({ hasText: 'Download queued in Atlas · Love · Bars player' }).waitFor();
  const file = await downloaded;
  if (file) assert.deepEqual(file.transfer, { source_type: 'yt-dlp', url: embed });
  await wait(page, pause);
});
