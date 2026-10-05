// Opt-in defect reproduction, intentionally outside tests/*.test.mjs.
// Run: node --test tests/reproductions/deviantart-mixed-gallery.test.mjs
// Controls should pass; mixed-media completeness assertions currently fail.
// Uses the sibling provider's actual descriptor, real collection/reaction/close
// code, synthetic DOM nodes, and an accepting in-memory Desktop transport.
// No browser profile, network request, real download, or personal data is used.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { getAssetTarget, getAssetType } from '../../src/content/assets.js';
import { postAssetOrBatchReaction } from '../../src/content/batch-reactions.js';
import { resolveAssetBatchContext } from '../../src/content/batch-providers/index.js';
import { armCloseTabForReaction } from '../../src/content/close-tab-reactions.js';
import { createCollectionProgress } from '../../src/content/collection-progress.js';
import { createGalleryReactionRuntime } from '../../src/content/gallery-reaction-runtime.js';

const descriptor = JSON.parse(await readFile(
  new URL('../../../atlas-deviantart/browser/capture.json', import.meta.url), 'utf8'));
const gallery = descriptor.rules.find(rule => rule.gallery)?.gallery;
assert.ok(gallery, 'The real DeviantArt provider must declare a gallery');
const pageUrl = 'https://www.deviantart.com/fixture/art/Synthetic-123';

for (const [label, types] of [
  ['single image', ['image']],
  ['single video', ['video']],
  ['three images', ['image', 'image', 'image']],
]) {
  test(`control: ${label}, Batch on, close after queue`, async t => {
    const f = fixture(t, types);
    await f.run();
    assert.deepEqual(f.queued.map(item => item.asset.type), types);
    assert.deepEqual(f.queued.map(item => item.asset.source), f.sources);
    assert.equal(f.closeIntents.length, 1);
    assert.equal(f.closeIntents[0].mode, 'after_queue');
    assert.deepEqual(f.errors, []);
    assert.equal(f.currentIndex(), 0);
  });
}

for (const imageCount of [2, 50]) {
  // Keep the real 30-second navigation deadline: the video is already ready,
  // so a failure cannot be explained by an artificially short load timeout.
  test(`reproduction: ${imageCount} images followed by a ready video must all queue`, async t => {
    const f = fixture(t, [...Array(imageCount).fill('image'), 'video']);
    await f.run();
    t.diagnostic(JSON.stringify(f.summary()));
    assert.equal(f.videoSelections(), 1, 'Collection reached the video slide');
    assert.equal(f.readyVideoSeen(), true, 'The normal asset reader resolves the ready video');
    assert.equal(f.progress.at(-1).phase, 'paused');
    assert.equal(f.progress.at(-1).collected, imageCount);
    assert.equal(f.progress.at(-1).queued, imageCount === 50 ? 50 : 0);
    assert.equal(f.closeIntents.length, 0, 'A failed collection never arms tab closing');
    assert.equal(f.panel.hidden, false, 'Current progress code keeps the paused panel visible');
    assert.match(f.errors[0], /BATCH_INCOMPLETE/, 'Current runtime reports an error');
    assert.equal(f.currentIndex(), 0, 'The collector restores the original image');
    // The desired behavior is deliberately asserted last, after capturing proof.
    assert.equal(f.queued.filter(item => item.asset.type === 'video').length, 1,
      'DEFECT: the ready gallery video was never queued');
  });
}

test('reproduction: a video with an image poster must queue the video, not its poster', async t => {
  const f = fixture(t, ['image', 'image', 'video'], { poster: true });
  await f.run();
  t.diagnostic(JSON.stringify(f.summary()));
  assert.equal(f.progress.at(-1).phase, 'completed');
  assert.equal(f.queued.length, 3);
  assert.equal(f.closeIntents.length, 1);
  assert.deepEqual(f.errors, []);
  assert.equal(f.queued.at(-1).asset.source, 'https://media.example.test/video-poster.jpg');
  assert.equal(f.queued.at(-1).asset.type, 'video',
    'DEFECT: an image poster is queued in place of the video');
});

function fixture(t, types, { poster = false } = {}) {
  let current = 0;
  let videoSelections = 0;
  let readyVideoSeen = false;
  const progress = [];
  const errors = [];
  const queued = [];
  const closeIntents = [];
  const documentContext = new globalThis.EventTarget();
  const locationContext = {
    get href() { return `${pageUrl}?file=${current + 1}`; },
    hostname: 'www.deviantart.com',
  };
  const root = new FakeElement('main');
  const section = new FakeElement('section');
  section.textContent = 'All Images';
  root.append(section);
  const media = types.map((type, index) => {
    const node = new FakeElement(type === 'video' ? 'video' : 'img');
    node.src = `https://media.example.test/item-${index + 1}.${type === 'video' ? 'mp4' : 'jpg'}`;
    node.currentSrc = node.src;
    node.readyState = 4;
    node.complete = true;
    node.naturalWidth = type === 'image' ? 1200 : undefined;
    node.naturalHeight = type === 'image' ? 800 : undefined;
    node.videoWidth = type === 'video' ? 1200 : undefined;
    node.videoHeight = type === 'video' ? 800 : undefined;
    node.parentElement = root;
    Object.defineProperty(node, 'isConnected', { get: () => current === index });
    return node;
  });
  const videoPoster = new FakeElement('img');
  videoPoster.src = 'https://media.example.test/video-poster.jpg';
  videoPoster.parentElement = root;
  Object.defineProperty(videoPoster, 'isConnected', { get: () => types[current] === 'video' });
  const thumbnails = types.length > 1 ? types.map((_type, index) => {
    const button = new FakeElement('button');
    button.click = () => {
      current = index;
      if (types[index] === 'video') {
        videoSelections += 1;
        readyVideoSeen = getAssetTarget(media[index])?.source === media[index].src;
      }
      documentContext.dispatchEvent(new globalThis.Event('gallerychange'));
    };
    const thumbnail = new FakeElement('img');
    thumbnail.src = `https://media.example.test/thumbnail-${index + 1}.jpg`;
    thumbnail.width = 40;
    thumbnail.height = 40;
    button.append(thumbnail);
    section.append(button);
    return thumbnail;
  }) : [];
  const images = () => [
    ...(types[current] === 'image' ? [media[current]] : poster ? [videoPoster] : []),
    ...thumbnails,
  ];
  for (const target of [documentContext, root]) {
    Object.defineProperty(target, 'images', { get: images });
    target.querySelectorAll = selector => {
      if (selector === 'section img') return thumbnails;
      if (selector === 'img') return images();
      if (selector === 'video') return types[current] === 'video' ? [media[current]] : [];
      if (selector === 'img, video') return [media[current], ...thumbnails];
      return [];
    };
  }
  documentContext.documentElement = new FakeElement('html');
  root.parentElement = documentContext.documentElement;
  documentContext.createElement = tag => new FakeElement(tag);
  const overlayRoot = new FakeElement('div');
  const collectionProgress = createCollectionProgress(overlayRoot, { documentContext,
    onCancel() {}, onRetry() {}, onDismiss() {} });
  const panel = overlayRoot.children[0];
  const overlay = {
    showCollectionProgress(state) { progress.push(state); collectionProgress.show(state); },
    showError(message) { errors.push(message); },
    clearError() {},
  };

  const previousChrome = globalThis.chrome;
  t.after(() => { globalThis.chrome = previousChrome; });
  globalThis.chrome = { runtime: { sendMessage(message, callback) {
    let payload;
    if (message.type === 'atlas-extension.asset-reaction-batch'
      || message.type === 'atlas-extension.asset-reaction') {
      const items = message.items ?? [{ asset: message.asset, referrerUrl: message.referrerUrl }];
      queued.push(...globalThis.structuredClone(items));
      const results = items.map(item => ({ asset_url: item.asset.source,
        download: { requested: true, status: 'queued' } }));
      payload = message.items ? { items: results } : results[0];
    } else if (message.type === 'atlas-extension.download-close-intent') {
      closeIntents.push(message);
      payload = { closed: true };
    } else if (message.type === 'atlas-extension.gallery-segment-acknowledged') {
      payload = {};
    } else {
      assert.fail(`Unexpected synthetic transport request: ${message.type}`);
    }
    callback({ ok: true, payload });
  } } };
  const closeAfterReaction = (payload, reactionType) => armCloseTabForReaction(payload, {
    locationContext, reactionType, loadModeForSiteDomain: async () => 'after_queue',
  });
  const runtime = createGalleryReactionRuntime({ getOverlay: () => overlay,
    updateBadgeState() {}, applyAccepted() {}, closeAfterReaction });
  return {
    queued, closeIntents, errors, progress, panel,
    sources: media.map(node => node.src),
    currentIndex: () => current,
    videoSelections: () => videoSelections,
    readyVideoSeen: () => readyVideoSeen,
    summary: () => ({ inputImages: types.filter(type => type === 'image').length,
      inputVideos: types.filter(type => type === 'video').length,
      queuedImages: queued.filter(item => item.asset.type === 'image').length,
      queuedVideos: queued.filter(item => item.asset.type === 'video').length,
      phase: progress.at(-1)?.phase, closeIntents: closeIntents.length,
      errorCount: errors.length, progressHidden: panel.hidden }),
    async run() {
      const asset = { ...getAssetTarget(media[0]), type: getAssetType(media[0]) };
      const batchContext = resolveAssetBatchContext({ element: media[0], documentContext,
        locationContext, pageContext: { provider: 'deviantart', url: pageUrl, gallery } });
      assert.equal(Boolean(batchContext), types.length > 1);
      const request = { id: 'synthetic', asset, batchContext, documentContext, locationContext,
        downloadAction: 'download', event: { type: 'like' }, currentState: { batch: { checked: true } } };
      await runtime.react(async () => {
        if (batchContext) await runtime.start(request);
        else await closeAfterReaction(await postAssetOrBatchReaction(request), 'like');
      });
    },
  };
}

class FakeElement {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attributes = {};
    this.style = {};
    this.className = '';
    this.width = 1200;
    this.height = 800;
  }
  append(...nodes) { for (const node of nodes) { node.parentElement = this; this.children.push(node); } }
  setAttribute(key, value) { this.attributes[key] = value; }
  getAttribute(key) { return key === 'src' ? this.src ?? null : this.attributes[key] ?? null; }
  removeAttribute(key) { delete this.attributes[key]; }
  addEventListener() {}
  getBoundingClientRect() { return { width: this.width, height: this.height }; }
  closest(selector) {
    for (let node = this; node; node = node.parentElement) {
      if (selector === 'section' && node.tagName === 'SECTION') return node;
      if (selector === 'button,[role="button"]' && node.tagName === 'BUTTON') return node;
    }
    return null;
  }
}
