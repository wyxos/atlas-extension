import assert from 'node:assert/strict';
import test from 'node:test';

import {
  describeAssetElement,
  describeReferrerAssetElement,
  getAssetReferrerHref,
  getAssetResolution,
  getAssetSource,
  getAssetType,
  hasAnchorAncestor,
  hasNearbyAnchorSibling,
} from '../src/content/assets.js';

test('detects supported asset element types', () => {
  assert.equal(getAssetType({ tagName: 'img' }), 'image');
  assert.equal(getAssetType({ tagName: 'VIDEO' }), 'video');
  assert.equal(getAssetType({ tagName: 'audio' }), 'audio');
  assert.equal(getAssetType({ tagName: 'canvas' }), null);
});

test('reads asset sources from direct and nested source elements', () => {
  assert.equal(getAssetSource({ currentSrc: ' https://example.test/image.jpg ', src: '' }), 'https://example.test/image.jpg');
  assert.equal(getAssetSource({ currentSrc: '', src: 'https://example.test/audio.mp3' }), 'https://example.test/audio.mp3');
  assert.equal(
    getAssetSource({
      currentSrc: '',
      querySelector: () => ({ src: 'https://example.test/video.mp4' }),
      src: '',
    }),
    'https://example.test/video.mp4',
  );
  assert.equal(getAssetSource({ currentSrc: '', src: '' }), null);
});

test('uses declared image src instead of responsive currentSrc variants', () => {
  assert.equal(
    getAssetSource({
      currentSrc: 'https://images-wixmp.example.test/f/example.png/v1/fit/w_768,h_1280,q_70,strp/example-preview.jpg',
      src: 'https://images-wixmp.example.test/f/example.png',
      tagName: 'IMG',
    }),
    'https://images-wixmp.example.test/f/example.png',
  );
});

test('uses the page url for media elements with browser-local sources', () => {
  assert.equal(
    getAssetSource({
      currentSrc: 'blob:https://www.youtube.com/asset',
      ownerDocument: {
        location: {
          href: 'https://www.youtube.com/watch?v=abc123',
        },
      },
      src: '',
      tagName: 'VIDEO',
    }),
    'https://www.youtube.com/watch?v=abc123',
  );
});

test('reads image and video asset resolutions when available', () => {
  assert.equal(getAssetResolution({ naturalHeight: 720, naturalWidth: 1280 }), '1280x720');
  assert.equal(getAssetResolution({ videoHeight: 1080, videoWidth: 1920 }), '1920x1080');
  assert.equal(getAssetResolution({ naturalHeight: 0, naturalWidth: 0 }), null);
});

test('describes only sourced media assets', () => {
  assert.deepEqual(
    describeAssetElement({
      closest: () => null,
      currentSrc: 'https://example.test/art.png',
      src: '',
      tagName: 'IMG',
    }),
    {
      resolution: null,
      source: 'https://example.test/art.png',
      type: 'image',
    },
  );
  assert.equal(describeAssetElement({ closest: () => null, currentSrc: '', src: '', tagName: 'IMG' }), null);
  assert.equal(describeAssetElement({ closest: () => null, currentSrc: 'https://example.test/file.bin', tagName: 'A' }), null);
});

test('ignores assets inside anchor ancestors', () => {
  const anchor = { tagName: 'A' };
  const linkedImage = {
    closest: (selector) => (selector === 'a' ? anchor : null),
    currentSrc: 'https://example.test/linked-art.png',
    src: '',
    tagName: 'IMG',
  };
  const unlinkedImage = {
    closest: () => null,
    currentSrc: 'https://example.test/art.png',
    src: '',
    tagName: 'IMG',
  };

  assert.equal(hasAnchorAncestor(linkedImage), true);
  assert.equal(hasAnchorAncestor(unlinkedImage), false);
  assert.equal(describeAssetElement(linkedImage), null);
});

test('ignores assets with nearby anchor siblings', () => {
  const linkedSibling = { tagName: 'A' };
  const siblingLinkedImage = {
    closest: () => null,
    currentSrc: 'https://example.test/sibling-linked-art.png',
    nextElementSibling: linkedSibling,
    parentElement: null,
    previousElementSibling: null,
    src: '',
    tagName: 'IMG',
  };

  assert.equal(hasNearbyAnchorSibling(siblingLinkedImage), true);
  assert.equal(describeAssetElement(siblingLinkedImage), null);
});

test('ignores assets whose parent has an anchor sibling', () => {
  const parent = {
    nextElementSibling: null,
    previousElementSibling: { tagName: 'a' },
    tagName: 'DIV',
  };
  const imageInsideSiblingLinkedWrapper = {
    closest: () => null,
    currentSrc: 'https://example.test/parent-sibling-linked-art.png',
    nextElementSibling: null,
    parentElement: parent,
    previousElementSibling: null,
    src: '',
    tagName: 'IMG',
  };

  assert.equal(hasNearbyAnchorSibling(imageInsideSiblingLinkedWrapper), true);
  assert.equal(describeAssetElement(imageInsideSiblingLinkedWrapper), null);
});

test('describes skipped assets by anchor ancestor referrer href', () => {
  const anchor = {
    href: 'https://www.example.test/post/ancestor',
    tagName: 'A',
  };
  const linkedImage = {
    closest: () => anchor,
    currentSrc: 'https://cdn.example.test/linked-art.png',
    naturalHeight: 720,
    naturalWidth: 1280,
    src: '',
    tagName: 'IMG',
  };

  assert.equal(getAssetReferrerHref(linkedImage), 'https://www.example.test/post/ancestor');
  assert.deepEqual(describeReferrerAssetElement(linkedImage), {
    referrerUrl: 'https://www.example.test/post/ancestor',
    resolution: '1280x720',
    source: 'https://cdn.example.test/linked-art.png',
    type: 'image',
  });
});

test('describes skipped assets by sibling and parent sibling referrer hrefs', () => {
  const siblingLinkedImage = {
    closest: () => null,
    currentSrc: 'https://cdn.example.test/sibling-art.png',
    nextElementSibling: {
      href: 'https://www.example.test/post/sibling',
      tagName: 'a',
    },
    parentElement: null,
    previousElementSibling: null,
    src: '',
    tagName: 'IMG',
  };
  const parent = {
    nextElementSibling: null,
    previousElementSibling: {
      href: 'https://www.example.test/post/parent-sibling',
      tagName: 'A',
    },
    tagName: 'DIV',
  };
  const parentSiblingLinkedImage = {
    closest: () => null,
    currentSrc: 'https://cdn.example.test/parent-sibling-art.png',
    nextElementSibling: null,
    parentElement: parent,
    previousElementSibling: null,
    src: '',
    tagName: 'IMG',
  };

  assert.equal(getAssetReferrerHref(siblingLinkedImage), 'https://www.example.test/post/sibling');
  assert.equal(getAssetReferrerHref(parentSiblingLinkedImage), 'https://www.example.test/post/parent-sibling');
  assert.equal(describeReferrerAssetElement(siblingLinkedImage)?.referrerUrl, 'https://www.example.test/post/sibling');
  assert.equal(
    describeReferrerAssetElement(parentSiblingLinkedImage)?.referrerUrl,
    'https://www.example.test/post/parent-sibling',
  );
});

test('ignores skipped asset referrers without http links', () => {
  const mailLinkedImage = {
    closest: () => ({
      href: 'mailto:artist@example.test',
      tagName: 'A',
    }),
    currentSrc: 'https://cdn.example.test/mail-art.png',
    src: '',
    tagName: 'IMG',
  };

  assert.equal(getAssetReferrerHref(mailLinkedImage), null);
  assert.equal(describeReferrerAssetElement(mailLinkedImage), null);
});
