import assert from 'node:assert/strict';
import test from 'node:test';

import {
  describeDragSource,
  dropEffectFor,
  isFileLink,
  isWindowExit,
  submitDroppedItem,
} from '../src/content/drop-zone-model.js';

const page = {
  documentContext: { title: '  Drop fixture  ' },
  locationContext: { href: 'https://gallery.example.test/board?id=1', hostname: 'gallery.example.test' },
};

function element(tagName, attributes = {}, { parent = null, text = '', props = {} } = {}) {
  const node = {
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
