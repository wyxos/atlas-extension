import { slotProfile } from './fixtures/gallery-adapters.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { collectAssetBatchItems, resolveAssetBatchContext } from '../src/content/batch-providers/index.js';
import { collectRedditBatchItems, resolveRedditBatchContext } from './fixtures/gallery-adapters.js';
import { postAssetOrBatchReaction } from '../src/content/batch-reactions.js';
import { reactionFailureFromError } from '../src/content/reaction-failure-state.js';
import { armCloseTabForReaction } from '../src/content/close-tab-reactions.js';
import { createCloseTabIntentManager } from '../src/background/close-tab-intents.js';

const locationContext = new URL('https://www.reddit.com/r/ImaginaryWomen/comments/1w3gag0/title/?utm_source=test');

test('only offers Reddit batch for the selected post gallery image', () => {
  const fixture = gallery();
  assert.equal(resolveAssetBatchContext({ element: fixture.images[0], locationContext, pageContext: slotProfile(locationContext.href) }).provider, 'reddit');
  for (const href of ['https://www.reddit.com/r/ImaginaryWomen/', 'https://notreddit.com/comments/1w3gag0/',
    'https://www.reddit.com/comments/other/']) {
    assert.equal(resolveRedditBatchContext({ element: fixture.images[0], locationContext: new URL(href) }), null);
  }
  assert.equal(resolveRedditBatchContext({ element: { closest: () => null }, locationContext }), null);
  assert.equal(resolveRedditBatchContext({ element: gallery({ count: 1 }).images[0], locationContext }), null);
  assert.equal(resolveRedditBatchContext({ element: fixture.images[0], locationContext: new URL('https://www.reddit.com/gallery/1w3gag0') }).provider, 'reddit');
});

test('collects all hidden slides in slot order using the highest srcset, without clicking', async () => {
  const fixture = gallery({ current: 2, order: [3, 1, 2] });
  const items = await collectAssetBatchItems(fixture.context, { locationContext });
  assert.deepEqual(items.map((item) => item.asset.source), [1, 2, 3].map(mediaUrl));
  assert.deepEqual(items.map((item) => item.asset.resolution), ['1080x1350', '1080x1350', '1080x1350']);
  assert.deepEqual(items.map((item) => new URL(item.referrerUrl).search), ['?img_index=1', '?img_index=2', '?img_index=3']);
  assert.equal(items[0].source, 'www.reddit.com');
  assert.equal(items[0].asset.type, 'image');
  assert.deepEqual(fixture.clicks, []);
});

test('uses scoped navigation for lazy images and restores the starting slide', async () => {
  const fixture = gallery({ count: 5, current: 2, missing: [4, 5] });
  const items = await collectRedditBatchItems({ context: fixture.context, locationContext, waitFor: immediateWait });
  assert.equal(items.length, 5);
  assert.equal(fixture.current(), 2);
  assert.deepEqual(fixture.clicks, [3, 4, 5, 4, 3, 2]);
});

test('rejects unresolved or missing slots and restores the carousel after failure', async () => {
  const fixture = gallery({ missing: [3], loadOnClick: false });
  await assert.rejects(collectRedditBatchItems({ context: fixture.context, locationContext, waitFor: immediateWait }), { code: 'BATCH_INCOMPLETE' });
  assert.equal(fixture.current(), 1);
  fixture.slots.delete(2);
  await assert.rejects(collectRedditBatchItems({ context: fixture.context, locationContext, waitFor: immediateWait }), { code: 'BATCH_INCOMPLETE' });
});

test('deduplicates repeated media only after validating all slots', async () => {
  const fixture = gallery();
  fixture.images[1].setSource(1);
  const items = await collectRedditBatchItems({ context: fixture.context, locationContext });
  assert.deepEqual(items.map((item) => item.asset.source), [mediaUrl(1), mediaUrl(3)]);
  fixture.images[2].setSource(null);
  await assert.rejects(collectRedditBatchItems({ context: fixture.context, locationContext, waitFor: immediateWait }), { code: 'BATCH_INCOMPLETE' });
});

test('rejects detached posts, changed routes, oversized galleries and unsupported media', async () => {
  const fixture = gallery();
  fixture.carousel.isConnected = false;
  await assert.rejects(collectRedditBatchItems({ context: fixture.context, locationContext }), { code: 'BATCH_POST_CHANGED' });
  fixture.carousel.isConnected = true;
  await assert.rejects(collectRedditBatchItems({ context: fixture.context, locationContext: new URL('https://reddit.com/comments/other/') }), { code: 'BATCH_POST_CHANGED' });
  await assert.rejects(collectRedditBatchItems({ context: gallery({ count: 51 }).context, locationContext }), { code: 'BATCH_TOO_LARGE' });
  fixture.slots.get(2).video = true;
  await assert.rejects(collectRedditBatchItems({ context: fixture.context, locationContext }), { code: 'BATCH_UNSUPPORTED_MEDIA' });
});

test('rejects a count change while collecting instead of silently returning a partial batch', async () => {
  const fixture = gallery({ missing: [3] });
  await assert.rejects(collectRedditBatchItems({
    context: fixture.context, locationContext,
    waitFor: (predicate) => { fixture.setTotal(4); return predicate(); },
  }), { code: 'BATCH_INCOMPLETE' });
});

test('enabled Reddit batch sends one ordered batch request; disabled sends only the selected image', async (t) => {
  const fixture = gallery();
  const messages = [];
  const originalChrome = globalThis.chrome;
  t.after(() => { if (originalChrome === undefined) delete globalThis.chrome; else globalThis.chrome = originalChrome; });
  globalThis.chrome = { runtime: {
    sendMessage(message, callback) { messages.push(message); callback({ ok: true, payload: { items: [] } }); },
  } };
  const options = {
    asset: { source: mediaUrl(2), type: 'image' }, batchContext: fixture.context,
    currentState: { batch: { checked: true } }, locationContext,
    downloadAction: 'download', event: { type: 'like' },
  };
  await postAssetOrBatchReaction(options);
  assert.equal(messages[0].type, 'atlas-extension.asset-reaction-batch');
  assert.deepEqual(messages[0].items.map((item) => item.asset.source), [1, 2, 3].map(mediaUrl));
  await postAssetOrBatchReaction({ ...options, currentState: { batch: { checked: false } } });
  assert.equal(messages[1].type, 'atlas-extension.asset-reaction');
  assert.equal(messages[1].asset.source, mediaUrl(2));
  fixture.slots.get(2).video = true;
  await assert.rejects(postAssetOrBatchReaction(options), { code: 'BATCH_UNSUPPORTED_MEDIA' });
  assert.equal(messages.length, 2);
  assert.match(reactionFailureFromError({ code: 'BATCH_INCOMPLETE' }).message, /Nothing was queued/);
});

test('Reddit After queue closes only after the complete batch response, and stays open on rejection', async (t) => {
  const fixture = gallery();
  const closedTabs = [];
  const intents = [];
  const manager = createCloseTabIntentManager({ tabsApi: {
    remove(tabId, callback) { closedTabs.push(tabId); callback(); },
  } });
  const originalChrome = globalThis.chrome;
  t.after(() => { if (originalChrome === undefined) delete globalThis.chrome; else globalThis.chrome = originalChrome; });
  let acknowledge;
  let submitted;
  globalThis.chrome = { runtime: {
    sendMessage(message, callback) {
      assert.equal(message.type, 'atlas-extension.asset-reaction-batch');
      assert.deepEqual(message.items.map((item) => item.asset.source), [1, 2, 3].map(mediaUrl));
      acknowledge = callback;
      submitted();
    },
  } };
  const submitAndClose = () => postAssetOrBatchReaction({
    asset: { source: mediaUrl(1), type: 'image' }, batchContext: fixture.context,
    currentState: { batch: { checked: true } }, locationContext,
    downloadAction: 'download', event: { type: 'like' },
  }).then((payload) => armCloseTabForReaction(payload, {
    locationContext, reactionType: 'like', loadModeForSiteDomain: async () => 'after_queue',
    sendIntent: (intent) => {
      intents.push(intent);
      return manager.armCloseIntent({ ...intent, tabId: 42 });
    },
  }));

  const requestSent = new Promise((resolve) => { submitted = resolve; });
  const pendingClose = submitAndClose();
  await requestSent;
  assert.deepEqual(intents, []);
  assert.deepEqual(closedTabs, []);
  acknowledge({ ok: true, payload: { items: [1, 2, 3].map((index) => ({
    asset_url: mediaUrl(index), download: { requested: true, status: 'queued' },
  })) } });
  const result = await pendingClose;
  assert.deepEqual(intents[0].assetUrls, [1, 2, 3].map(mediaUrl));
  assert.equal(result.closeResult.trackedAssetCount, 3);
  assert.deepEqual(closedTabs, [42]);

  const nextRequestSent = new Promise((resolve) => { submitted = resolve; });
  const failedClose = submitAndClose();
  const rejection = assert.rejects(failedClose, { code: 'REACTION_BATCH_FAILED' });
  await nextRequestSent;
  acknowledge({ ok: false, error: { code: 'REACTION_BATCH_FAILED', message: 'Batch save failed' } });
  await rejection;
  assert.equal(intents.length, 1);
  assert.deepEqual(closedTabs, [42]);
});

function mediaUrl(index) {
  return `https://preview.redd.it/art-v0-image${index}.jpg?width=1080&auto=webp&s=signature`;
}

async function immediateWait(predicate) { return predicate(); }

function gallery({ count = 3, current = 1, order = null, missing = [], loadOnClick = true } = {}) {
  let total = count;
  const clicks = [];
  const images = [];
  const slots = new Map();
  const carousel = {
    isConnected: true,
    getAttribute: (name) => name === 'post-id' ? 't3_1w3gag0' : null,
    querySelectorAll: () => (order ?? [...slots.keys()]).map((page) => slots.get(page)),
    querySelector: (selector) => slots.get(Number(selector.match(/page-(\d+)/)?.[1])) ?? null,
    shadowRoot: {
      querySelectorAll(selector) { return selector === 'button' ? ['Next page', 'Previous page'].map(label => this.querySelector('button[aria-label=' + label + ']')) : []; },
      querySelector(selector) {
        if (selector === 'faceplate-carousel') return { getAttribute: () => `Item ${current} of ${total}` };
        const next = selector.includes('Next page');
        return {
          getAttribute: (name) => name === 'aria-label' ? (next ? 'Next page' : 'Previous page') : name === 'aria-disabled' ? ((next ? current >= total : current <= 1) ? 'true' : 'false') : null,
          click() {
            current += next ? 1 : -1;
            clicks.push(current);
            if (loadOnClick && missing.includes(current)) images[current - 1].setSource(current);
          },
        };
      },
    },
  };
  for (let page = 1; page <= count; page += 1) {
    let source = missing.includes(page) ? null : page;
    const image = {
      tagName: 'IMG', naturalWidth: 640, naturalHeight: 800,
      ownerDocument: { location: locationContext },
      get src() { return source === null ? '' : mediaUrl(source).replace('1080', '640'); },
      get currentSrc() { return this.src; },
      setSource(value) { source = value; },
      getAttribute(name) {
        if (name === 'src') return this.src;
        if (name === 'srcset' && source !== null) return `${this.src} 640w, ${mediaUrl(source)} 1080w`;
        return null;
      },
      closest(selector) { return selector === 'gallery-carousel' ? carousel : selector === 'figure' ? {} : null; },
      querySelector: () => null,
    };
    images.push(image);
    slots.set(page, {
      getAttribute: () => `page-${page}`,
      querySelector(selector) { return selector === 'figure img' ? image : this.video ? {} : null; },
    });
  }
  return {
    carousel, images, slots, clicks, current: () => current, setTotal: (value) => { total = value; },
    context: resolveRedditBatchContext({ element: images[0], locationContext }),
  };
}
