import assert from 'node:assert/strict';
import test from 'node:test';

import {
  containedMediaFor,
  describeDragSource,
  dropEffectFor,
  isFileLink,
  isWindowExit,
  mediaKindForUrl,
  resolveDropReaction,
  submitDroppedItem,
} from '../src/content/drop-zone-model.js';

const page = {
  documentContext: { title: '  Drop fixture  ' },
  locationContext: { href: 'https://gallery.example.test/board?id=1', hostname: 'gallery.example.test' },
};

function element(tagName, attributes = {}, { parent = null, text = '', props = {}, children = [] } = {}) {
  const node = {
    querySelectorAll: (selector) => children.filter(child => matches(child, selector)),
    nodeType: 1,
    tagName,
    parentElement: parent,
    textContent: text,
    getAttribute: (name) => attributes[name] ?? null,
    hasAttribute: (name) => name in attributes,
    closest(selector) {
      for (let current = node; current; current = current.parentElement) {
        if (selector.split(',').map(value => value.trim()).some(part => matches(current, part))) return current;
      }
      return null;
    },
    ...props,
  };
  return node;
}

function matches(node, selector) {
  if (selector.includes(',')) return selector.split(',').some(part => matches(node, part.trim()));
  const [tag, attribute] = selector.replace(']', '').split('[');
  return node.tagName.toLowerCase() === tag && (!attribute || node.hasAttribute(attribute));
}

test('an image drag captures the asset, page and element details sent to Atlas', () => {
  const anchor = element('A', { href: '/posts/7' }, { props: { href: 'https://gallery.example.test/posts/7' } });
  const image = element('IMG', { src: '/media/cat%20one.png', alt: ' A cat ', title: 'Cat title' }, {
    parent: anchor,
    props: { src: 'https://cdn.example.test/media/cat%20one.png', currentSrc: 'https://cdn.example.test/media/cat%20one.png', naturalWidth: 640, naturalHeight: 480 },
  });

  assert.deepEqual(describeDragSource(image, page), {
    kind: 'image',
    label: 'cat one.png',
    asset: {
      altText: 'A cat',
      captureMethod: 'drop-zone',
      elementUrl: 'https://gallery.example.test/posts/7',
      filename: 'cat one.png',
      pageTitle: 'Drop fixture',
      pageUrl: 'https://gallery.example.test/board?id=1',
      resolution: '640x480',
      source: 'https://cdn.example.test/media/cat%20one.png',
      titleText: 'Cat title',
      type: 'image',
    },
  });
});

test('file and page links are distinguished and text nodes resolve to their anchor', () => {
  const file = element('A', { href: '/files/report.pdf' }, { text: ' Q3 report ', props: { href: 'https://gallery.example.test/files/report.pdf' } });
  const textNode = { nodeType: 3, parentElement: file };
  const fileItem = describeDragSource(textNode, page);
  assert.equal(fileItem.kind, 'file');
  assert.equal(fileItem.asset.type, 'file');
  assert.equal(fileItem.asset.filename, 'report.pdf');
  assert.equal(fileItem.asset.linkText, 'Q3 report');
  assert.equal(fileItem.asset.elementUrl, 'https://gallery.example.test/files/report.pdf');

  const named = element('A', { href: '/export', download: 'board.zip' }, { props: { href: 'https://gallery.example.test/export' } });
  assert.equal(describeDragSource(named, page).asset.filename, 'board.zip');
  assert.equal(describeDragSource(named, page).kind, 'file');

  const link = element('A', { href: '/about.html' }, { text: 'About', props: { href: 'https://gallery.example.test/about.html' } });
  const linkItem = describeDragSource(link, page);
  assert.equal(linkItem.kind, 'link');
  assert.equal(linkItem.asset.type, 'link');
  assert.equal(linkItem.asset.filename, undefined);
  assert.equal(linkItem.label, 'About');
});

test('non-HTTP sources and unrelated drags do not open the drop zone', () => {
  assert.equal(describeDragSource(element('IMG', {}, { props: { src: 'data:image/png;base64,AAAA' } }), page), null);
  assert.equal(describeDragSource(element('A', { href: 'javascript:void 0' }, { props: { href: 'javascript:void 0' } }), page), null);
  assert.equal(describeDragSource(element('DIV', { draggable: 'true' }), page), null);
  assert.equal(describeDragSource(null, page), null);
});

test('file link detection, drop effects and window exits', () => {
  assert.equal(isFileLink('https://a.test/archive.tar.gz'), true);
  assert.equal(isFileLink('https://a.test/index.php?id=1'), false);
  assert.equal(isFileLink('https://a.test/folder/'), false);
  assert.equal(dropEffectFor('all'), 'copy');
  assert.equal(dropEffectFor('copyLink'), 'copy');
  assert.equal(dropEffectFor('link'), 'link');
  assert.equal(dropEffectFor('move'), 'move');
  const view = { innerWidth: 800, innerHeight: 600 };
  assert.equal(isWindowExit({ relatedTarget: null, clientX: 0, clientY: 0 }, view), true);
  assert.equal(isWindowExit({ relatedTarget: null, clientX: 400, clientY: 300 }, view), false);
  assert.equal(isWindowExit({ relatedTarget: {}, clientX: 0, clientY: 0 }, view), false);
});

test('dropped items keep an existing reaction and never override a blacklist', async () => {
  const asset = { source: 'https://cdn.example.test/a.png', type: 'image' };
  const posted = [];
  const post = async (request) => { posted.push(request); return { download: { status: 'queued' } }; };

  const fresh = await submitDroppedItem({ asset }, { ...page, fetchStatuses: async () => ({ assets: {} }), post });
  assert.equal(fresh.download.status, 'queued');
  assert.equal(fresh.reactionType, 'like');
  assert.deepEqual(posted.at(-1), { asset, reactionType: 'like', referrerUrl: page.locationContext.href,
    source: 'gallery.example.test', timeoutMs: 30000 });

  await submitDroppedItem({ asset }, { ...page, fetchStatuses: async () => ({ assets: { [asset.source]: { reaction: 'love' } } }), post });
  assert.equal(posted.at(-1).reactionType, 'love');

  await submitDroppedItem({ asset }, { ...page, fetchStatuses: async () => { throw new Error('offline'); }, post });
  assert.equal(posted.at(-1).reactionType, 'like');

  const count = posted.length;
  const skipped = await submitDroppedItem({ asset }, { ...page,
    fetchStatuses: async () => ({ assets: { [asset.source]: { blacklisted_at: '2026-01-01T00:00:00Z' } } }), post });
  assert.deepEqual(skipped, { skipped: 'blacklisted' });
  assert.equal(posted.length, count);
});

test('the picker choice is sent once, and the status lookup is shared with the picker', async () => {
  const asset = { source: 'https://cdn.example.test/a.png', type: 'image' };
  const posted = [];
  const post = async (request) => { posted.push(request); return {}; };
  let seenState;
  const result = await submitDroppedItem({ asset }, { ...page, post,
    fetchStatuses: async () => ({ assets: { [asset.source]: { reaction: 'love' } } }),
    chooseReaction: async ({ statePromise }) => { seenState = await statePromise; return 'funny'; } });
  assert.deepEqual(seenState, { reaction: 'love' });
  assert.equal(result.reactionType, 'funny');
  assert.equal(posted.length, 1);
  assert.equal(posted[0].reactionType, 'funny');
});

test('reaction decisions: explicit pick wins, otherwise keep, blacklist is never re-downloaded by default', () => {
  assert.deepEqual(resolveDropReaction({}), { reactionType: 'like', current: null, explicit: false });
  assert.equal(resolveDropReaction({ state: { reaction: 'funny' } }).reactionType, 'funny');
  assert.equal(resolveDropReaction({ state: { reaction: 'funny' }, picked: 'love' }).reactionType, 'love');
  assert.deepEqual(resolveDropReaction({ state: { blacklisted_at: 'x' } }), { skipped: 'blacklisted' });
  assert.deepEqual(resolveDropReaction({ state: { blacklisted_at: 'x' }, picked: 'blacklist' }), { skipped: 'blacklisted' });
  assert.equal(resolveDropReaction({ state: { blacklisted_at: 'x' }, picked: 'like' }).reactionType, 'like');
  assert.equal(resolveDropReaction({ picked: 'blacklist' }).reactionType, 'blacklist');
  assert.equal(resolveDropReaction({ picked: 'bogus' }).reactionType, 'like');
});

test('media links are classified by extension and by the link type attribute', () => {
  assert.equal(mediaKindForUrl('https://a.test/v/clip.MP4'), 'video');
  assert.equal(mediaKindForUrl('https://a.test/live/index.m3u8'), 'video');
  assert.equal(mediaKindForUrl('https://a.test/a/tone.mp3?x=1'), 'audio');
  assert.equal(mediaKindForUrl('https://a.test/stream', 'audio/ogg'), 'audio');
  assert.equal(mediaKindForUrl('https://a.test/report.pdf'), null);
  const link = element('A', { href: '/stream/42', type: 'video/mp4' }, { text: 'Clip', props: { href: 'https://a.test/stream/42' } });
  const linkItem = describeDragSource(link, page);
  assert.equal(linkItem.kind, 'video');
  assert.equal(linkItem.asset.mimeType, 'video/mp4');
  assert.equal(linkItem.asset.filename, '42');
  const audio = describeDragSource(element('A', { href: '/a/tone.mp3' }, { text: 'Tone', props: { href: 'https://a.test/a/tone.mp3' } }), page);
  assert.equal(audio.asset.type, 'audio');
});

test('video and audio elements resolve currentSrc or <source> and capture duration, size and poster', () => {
  const source = element('SOURCE', { src: '/v/b.webm', type: 'video/webm' }, { props: { src: 'https://a.test/v/b.webm' } });
  const video = element('VIDEO', { poster: '/p.png', title: 'Clip' }, { children: [source], props: {
    currentSrc: '', src: '', poster: 'https://a.test/p.png', duration: 2.0004, videoWidth: 320, videoHeight: 180 } });
  source.parentElement = video;
  const fromSource = describeDragSource(source, page);
  assert.deepEqual(fromSource.asset, {
    captureMethod: 'drop-zone', duration: 2, filename: 'b.webm', mimeType: 'video/webm', pageTitle: 'Drop fixture',
    pageUrl: page.locationContext.href, posterUrl: 'https://a.test/p.png', resolution: '320x180',
    source: 'https://a.test/v/b.webm', titleText: 'Clip', type: 'video',
  });
  const audio = element('AUDIO', {}, { props: { currentSrc: 'https://a.test/a/t.ogg', duration: Infinity } });
  const audioItem = describeDragSource(audio, page);
  assert.equal(audioItem.kind, 'audio');
  assert.equal(audioItem.asset.duration, undefined);
  assert.equal(audioItem.asset.resolution, undefined);
});

test('blob, data and MediaStream playback is reported as unsupported instead of sent', () => {
  const blob = element('VIDEO', {}, { props: { currentSrc: 'blob:https://a.test/1234', src: 'blob:https://a.test/1234' } });
  assert.deepEqual(describeDragSource(blob, page), { asset: null, kind: 'video', label: 'Video', unsupported: 'stream' });
  const live = element('VIDEO', {}, { props: { currentSrc: '', src: '', srcObject: {} } });
  assert.equal(describeDragSource(live, page).unsupported, 'stream');
  assert.equal(describeDragSource(element('AUDIO', {}, { props: { currentSrc: '', src: '' } }), page).unsupported, 'no-source');
});

test('overlays resolve the media or image stacked underneath; text links stay links', () => {
  const video = element('VIDEO', {}, { props: { currentSrc: 'https://a.test/v.webm', src: 'https://a.test/v.webm' } });
  const overlay = element('A', { href: '/watch/1', 'aria-label': 'Open' }, { props: { href: 'https://a.test/watch/1' } });
  const covered = describeDragSource(overlay, { ...page, point: { x: 5, y: 5 }, elementsFromPoint: () => [overlay, video] });
  assert.equal(covered.kind, 'video');
  assert.equal(covered.asset.elementUrl, 'https://a.test/watch/1');

  const div = element('DIV', { draggable: 'true' });
  const image = element('IMG', { alt: 'Under' }, { props: { src: 'https://a.test/u.png', currentSrc: 'https://a.test/u.png' } });
  assert.equal(describeDragSource(div, { ...page, point: { x: 1, y: 1 }, elementsFromPoint: () => [div, image] }).kind, 'image');

  const textLink = element('A', { href: '/about' }, { text: 'About', props: { href: 'https://a.test/about' } });
  assert.equal(describeDragSource(textLink, { ...page, point: { x: 1, y: 1 }, elementsFromPoint: () => [textLink, image] }).kind, 'link');
});

test('custom players resolve their single hidden media element; ambiguous widgets do not', () => {
  const audio = element('AUDIO', { title: 'Tone' }, { props: { currentSrc: 'https://a.test/a/tone.ogg', duration: 2 } });
  const player = element('DIV', {}, { children: [audio] });
  const label = element('SPAN', {}, { parent: player, text: 'Tone · 0:02' });
  assert.equal(containedMediaFor(label), audio);
  const item = describeDragSource(label, page);
  assert.equal(item.kind, 'audio');
  assert.equal(item.asset.source, 'https://a.test/a/tone.ogg');
  assert.equal(item.asset.duration, 2);
  const gallery = element('DIV', {}, { children: [audio, element('VIDEO')] });
  assert.equal(containedMediaFor(element('SPAN', {}, { parent: gallery })), null);
  assert.equal(containedMediaFor(element('SPAN', {}, { parent: element('BODY', {}, { children: [audio] }) })), null);
});
