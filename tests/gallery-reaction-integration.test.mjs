import assert from 'node:assert/strict';
import test from 'node:test';
import { performance } from 'node:perf_hooks';
import { getEventListeners } from 'node:events';
import { resolveAssetBatchContext } from '../src/content/batch-providers/index.js';
import { createGalleryReactionOperation } from '../src/content/gallery-reaction-operation.js';
import { createThumbnailGallery } from '../src/content/gallery/thumbnails.js';

const baseUrl = 'https://gallery.example.test/item';
const source = index => `https://media.example.test/image?id=${index}`;
const thumbnailSpec = { kind: 'thumbnails', imageSelector: 'img', navigationSelector: 'button',
  previousLabel: 'Earlier', nextLabel: 'Later', indexParameter: 'slide', sourceMode: 'src', clearQuery: true,
  thumbnailSelector: '.strip img', thumbnailButtonSelector: '.thumb', thumbnailContainerSelector: '.strip', thumbnailContainerText: 'Pictures' };
const slotSpec = { kind: 'slots', rootSelector: '.gallery', rootIdentityAttribute: 'data-post', rootIdentityPrefix: 'entry-',
  assetAncestor: '.art', slotSelector: '.slide', slotAttribute: 'data-index', slotPrefix: 'image-',
  imageSelector: 'img', unsupportedSelector: 'video', positionSelector: '.position', positionAttribute: 'data-position',
  navigationSelector: 'button', previousLabel: 'Earlier', nextLabel: 'Later', indexParameter: 'slide', sourceMode: 'src', clearQuery: true };

// Synthetic DOM implements ancestry, connected nodes and MutationObserver
// records so the real collectors exercise browser inventory caching and waits.
function environment() {
  const observers = new Set();
  const stats = { inventoryQueries: 0, mediaQueries: 0, visitedInventoryNodes: 0 };
  const document = { defaultView: { MutationObserver: class {
    constructor(callback) { this.callback = callback; this.records = []; }
    observe(root, options) { this.root = root; this.options = options; observers.add(this); }
    takeRecords() { return this.records.splice(0); }
    disconnect() { observers.delete(this); }
  } } };
  function mutation(record) {
    for (const observer of observers) {
      if (observer.root !== record.target && !(observer.options.subtree && observer.root.contains(record.target))) continue;
      if (record.type === 'attributes' && observer.options.attributeFilter && !observer.options.attributeFilter.includes(record.attributeName)) continue;
      observer.records.push(record);
      queueMicrotask(() => { const records = observer.takeRecords(); if (records.length) observer.callback(records); });
    }
  }
  function node(parentElement = null, attributes = {}) {
    const value = new globalThis.EventTarget();
    Object.assign(value, { parentElement, ownerDocument: document, isConnected: true,
      getAttribute: name => attributes[name] ?? null,
      getBoundingClientRect: () => ({ width: 800, height: 600 }),
      querySelector: () => null, querySelectorAll: () => [],
      matches: () => false,
      closest(selector) { for (let parent = this; parent; parent = parent.parentElement) if (parent.matches(selector)) return parent; return null; },
      contains(child) { for (let parent = child; parent; parent = parent.parentElement) if (parent === this) return true; return false; },
      setAttribute(name, next) { attributes[name] = next; mutation({ type: 'attributes', target: this, attributeName: name }); },
    });
    return value;
  }
  function image(parent, url, attributes = {}) {
    const value = node(parent, { ...attributes, src: url });
    Object.assign(value, { tagName: 'IMG', src: url, complete: true, naturalWidth: 800, naturalHeight: 600 });
    value.getAttribute = name => name === 'src' ? value.src : attributes[name] ?? null;
    return value;
  }
  return { document, node, image, mutation, observers, stats };
}

function fixture({ count = 200, kind = 'thumbnails', duplicates = 0, unrelated = 0, start = Math.floor(count / 2) } = {}) {
  const env = environment();
  const { document, node, image, mutation, stats } = env;
  let selected = start;
  const root = node();
  const location = { get href() { return `${baseUrl}?slide=${selected}`; } };
  const clicks = [];
  let currentImage;
  let strip;
  let controls = [];
  let slots = [];
  let thumbnailNodes = [];
  let available;
  const select = index => {
    selected = index;
    clicks.push(index);
    if (kind === 'slots') {
      available.add(index);
      position.setAttribute('data-position', `${selected} of ${count}`);
    } else {
      currentImage.src = source(index);
      mutation({ type: 'attributes', target: currentImage, attributeName: 'src' });
      // Active styling should not invalidate an otherwise unchanged strip.
      controls[index - 1]?.setAttribute('class', 'selected');
    }
  };
  const previous = node(null, { 'aria-label': 'Earlier' });
  const next = node(null, { 'aria-label': 'Later' });
  previous.click = () => select(selected - 1);
  next.click = () => select(selected + 1);
  const navigation = () => [selected > 1 ? previous : null, selected < count ? next : null].filter(Boolean);
  const position = node();
  position.getAttribute = () => `${selected} of ${count}`;
  if (kind === 'slots') {
    root.matches = selector => selector === '.gallery';
    root.getAttribute = () => 'entry-sample';
    available = new Set([start]);
    slots = Array.from({ length: count }, (_, index) => {
      const slot = node(root, { 'data-index': `image-${index + 1}` });
      slot.matches = selector => selector === '.slide';
      const art = node(slot);
      art.matches = selector => selector === '.art';
      const media = image(art, source(index + 1));
      slot.querySelector = selector => selector === 'img' && available.has(index + 1) ? media : null;
      if (index + 1 === start) currentImage = media;
      return slot;
    });
    root.querySelectorAll = selector => {
      if (selector !== '.slide') return [];
      stats.inventoryQueries += 1; stats.visitedInventoryNodes += slots.length;
      return slots;
    };
    const shadowRoot = node(root);
    position.parentElement = shadowRoot;
    previous.parentElement = shadowRoot; next.parentElement = shadowRoot;
    shadowRoot.querySelector = selector => selector === '.position' ? position : null;
    shadowRoot.querySelectorAll = selector => selector === 'button' ? navigation() : [];
    root.shadowRoot = shadowRoot;
  } else {
    strip = node(root); strip.textContent = 'Pictures'; strip.matches = selector => selector === '.strip';
    currentImage = image(root, source(start));
    controls = Array.from({ length: count }, (_, index) => {
      const button = node(strip);
      button.matches = selector => selector === '.thumb';
      button.click = () => select(index + 1);
      return button;
    });
    const makeThumb = index => {
      const button = node(strip); button.matches = selector => selector === '.thumb'; button.click = () => select(index + 1);
      const thumbnail = image(button, `https://media.example.test/thumb?id=${index + 1}`);
      thumbnail.getBoundingClientRect = () => ({ width: 32, height: 32 });
      return thumbnail;
    };
    thumbnailNodes = controls.map((button, index) => {
      const thumbnail = image(button, `https://media.example.test/thumb?id=${index + 1}`);
      thumbnail.getBoundingClientRect = () => ({ width: 32, height: 32 });
      return thumbnail;
    });
    for (let index = 0; index < duplicates; index += 1) thumbnailNodes.push(makeThumb(index % count));
    previous.parentElement = root; next.parentElement = root;
    root.querySelectorAll = selector => {
      if (selector === 'img') { stats.mediaQueries += 1; return [currentImage, ...thumbnailNodes]; }
      if (selector === '.strip img') {
        stats.inventoryQueries += 1; stats.visitedInventoryNodes += thumbnailNodes.length;
        return kind === 'navigation' ? [] : thumbnailNodes;
      }
      return selector === 'button' ? navigation() : [];
    };
  }
  const unrelatedStrip = node(); unrelatedStrip.textContent = 'Pictures'; unrelatedStrip.matches = selector => selector === '.strip';
  const unrelatedImages = Array.from({ length: unrelated }, (_, index) => {
    const button = node(unrelatedStrip); button.matches = selector => selector === '.thumb';
    button.click = () => { throw Error('Unrelated gallery control activated'); };
    return image(button, `https://media.example.test/unrelated?id=${index}`);
  });
  document.querySelectorAll = selector => selector === '.strip img'
    ? [...root.querySelectorAll(selector), ...unrelatedImages] : root.querySelectorAll(selector);
  const profile = { provider: 'unknown-example-provider', url: location.href, galleryKey: 'sample', gallery: kind === 'slots' ? slotSpec : thumbnailSpec };
  const batchContext = resolveAssetBatchContext({ element: currentImage, documentContext: document, locationContext: location, pageContext: profile });
  assert.ok(batchContext, 'The real adapter resolves the clicked synthetic gallery');
  return { ...env, root, locationContext: location, documentContext: document, batchContext, current: () => selected, clicks,
    start, count, thumbnailNodes, strip, slots };
}

function operationFixture(options, { failSegment } = {}) {
  const f = fixture(options);
  const requests = [];
  const server = new Map();
  const accepted = [];
  const progress = [];
  let failed = false;
  let activeRequests = 0;
  const operation = createGalleryReactionOperation({ batchContext: f.batchContext, documentContext: f.documentContext,
    locationContext: f.locationContext, event: { type: 'like' }, downloadAction: 'download' }, {
    operationId: 'synthetic-integration',
    submit: async request => {
      assert.equal(activeRequests++, 0, 'Segments are submitted sequentially');
      try {
        assert.ok(request.items.length > 0 && request.items.length <= 50);
        requests.push(globalThis.structuredClone(request));
        let payload = server.get(request.idempotencyKey);
        if (!payload) {
          accepted.push(...request.items);
          payload = { items: request.items.map(item => ({ asset_url: item.asset.source,
            file: { id: new URL(item.asset.source).searchParams.get('id'), url: item.asset.source }, download: { status: 'queued', requested: true } })) };
          server.set(request.idempotencyKey, payload);
        }
        if (!failed && request.idempotencyKey === `synthetic-integration:${failSegment}`) {
          failed = true;
          throw Object.assign(new Error('Synthetic acknowledgement timeout'), { code: 'DESKTOP_TIMEOUT' });
        }
        await Promise.resolve();
        return payload;
      } finally { activeRequests -= 1; }
    },
  });
  return { ...f, operation, requests, accepted, progress, run: () => operation.run({ onProgress: state => progress.push(state) }) };
}

for (const count of [200, 1001]) for (const kind of ['thumbnails', 'navigation', 'slots']) {
  test(`real ${kind} collector and operation queue ${count} query-ID images in bounded segments`, async t => {
    const f = operationFixture({ count, kind });
    const started = performance.now();
    const result = await f.run();
    t.diagnostic(`${kind}: ${count} items, ${(performance.now() - started).toFixed(1)} ms, ${f.stats.inventoryQueries} inventory reads, ${f.stats.visitedInventoryNodes} inventory nodes visited`);
    assert.equal(result.items.length, count);
    assert.deepEqual(f.requests.map(request => request.items.length), Array.from({ length: Math.ceil(count / 50) }, (_, index) => Math.min(50, count - index * 50)));
    assert.deepEqual(f.accepted.map(item => item.asset.source), Array.from({ length: count }, (_, index) => source(index + 1)));
    assert.deepEqual(f.accepted.map(item => Number(new URL(item.referrerUrl).searchParams.get('slide'))), Array.from({ length: count }, (_, index) => index + 1));
    assert.equal(f.current(), f.start);
    assert.equal(f.operation.state.phase, 'completed');
    assert.equal(f.operation.state.queued, count);
    assert.equal(f.operation.state.total, count);
    assert.ok(f.progress.some(state => state.phase === 'restoring'));
    assert.ok(f.progress.some(state => state.phase === 'queueing'));
    assert.equal(f.observers.size, 0, 'All inventory/wait observers are released');
    for (const event of ['load', 'error', 'loadedmetadata', 'loadeddata', 'canplay', 'emptied', 'gallerychange']) {
      assert.equal(getEventListeners(f.root, event).length, 0);
    }
    assert.ok(f.stats.inventoryQueries <= 6, 'Gallery inventory reads stay constant across a traversal');
    assert.ok(f.stats.visitedInventoryNodes <= count * 6, 'Inventory scanning remains linear in gallery size');
    assert.ok(f.stats.mediaQueries <= 4, 'An img selector does not repeatedly scan all thumbnails');
  });
}

test('actual collection queues 30 logical items despite 70 duplicated and 60 unrelated thumbnail controls', async () => {
  const f = operationFixture({ count: 30, duplicates: 70, unrelated: 60, start: 12 });
  await f.run();
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].items.length, 30);
  assert.deepEqual(f.accepted.map(item => item.asset.source), Array.from({ length: 30 }, (_, index) => source(index + 1)));
  assert.equal(f.current(), 12);
});

test('attribute-based image selectors refresh media candidates without replacing nodes', async () => {
  const env = environment();
  const root = env.node();
  let selected = 0;
  const images = [env.image(root, source(1)), env.image(root, source(2))];
  images.forEach((image, index) => { image.matches = selector => selector === 'img.active' && index === selected; });
  const select = index => {
    selected = index;
    images.forEach(image => image.setAttribute('class', image === images[index] ? 'active' : 'inactive'));
  };
  const previous = env.node(root, { 'aria-label': 'Earlier' }); previous.click = () => select(0);
  const next = env.node(root, { 'aria-label': 'Later' }); next.click = () => select(1);
  root.querySelectorAll = selector => selector === 'img.active' ? [images[selected]]
    : selector === 'button' ? [selected ? previous : next] : [];
  env.document.querySelectorAll = root.querySelectorAll;
  const locationContext = { get href() { return `${baseUrl}?slide=${selected + 1}`; } };
  const collector = createThumbnailGallery({ provider: 'unknown-provider', url: baseUrl,
    gallery: { ...thumbnailSpec, imageSelector: 'img.active' } });
  const result = await collector.collect({ element: images[0], documentContext: env.document, locationContext });
  assert.deepEqual(result.map(item => item.asset.source), [source(1), source(2)]);
  assert.equal(selected, 0);
  assert.equal(env.observers.size, 0);
});

test('lost midway acknowledgement restores, retries an identical segment and skips previously accepted gallery items', async () => {
  const f = operationFixture({ count: 200, start: 75 }, { failSegment: 1 });
  await assert.rejects(f.run(), { code: 'DESKTOP_TIMEOUT' });
  assert.equal(f.current(), 75);
  assert.equal(f.operation.state.phase, 'paused');
  assert.equal(f.operation.state.queued, 50);
  assert.equal(f.observers.size, 0);
  const result = await f.run();
  assert.deepEqual(f.requests[2], f.requests[1]);
  assert.equal(f.accepted.length, 200);
  assert.equal(new Set(f.accepted.map(item => item.referrerUrl)).size, 200);
  assert.equal(result.items.length, 200);
  assert.equal(f.current(), 75);
  assert.equal(f.operation.state.phase, 'completed');
  assert.equal(f.observers.size, 0);
});

test('inventory mutation invalidation rejects a changed gallery before its next item is submitted', async () => {
  const f = operationFixture({ count: 200, start: 75 });
  await assert.rejects(f.operation.run({ onProgress: state => {
    if (state.phase === 'collecting' && state.collected === 10) {
      const removed = f.thumbnailNodes.pop();
      removed.isConnected = false;
      f.mutation({ type: 'childList', target: f.strip, addedNodes: [], removedNodes: [removed] });
    }
  } }), { code: 'BATCH_INCOMPLETE' });
  assert.equal(f.accepted.length, 0);
  assert.equal(f.current(), 75);
  assert.equal(f.observers.size, 0);
});

test('a refreshed inventory with the same count still checks item identity after mutation', async () => {
  const f = operationFixture({ count: 200, start: 75 });
  await assert.rejects(f.operation.run({ onProgress: state => {
    if (state.phase === 'collecting' && state.collected === 10) {
      const changed = f.thumbnailNodes[100];
      changed.src = 'https://media.example.test/thumb?id=changed';
      f.mutation({ type: 'attributes', target: changed, attributeName: 'src' });
    }
  } }), { code: 'BATCH_INCOMPLETE' });
  assert.equal(f.accepted.length, 0);
  assert.equal(f.current(), 75);
  assert.equal(f.observers.size, 0);
});
