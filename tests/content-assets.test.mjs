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

test('ignores assets whose parent has a non-adjacent anchor sibling', () => {
  const linkedSibling = {
    href: 'https://www.example.test/post/non-adjacent-sibling',
    tagName: 'A',
  };
  const parent = createParent('DIV', null);
  const grandParent = {
    children: [
      createParent('DIV', null),
      linkedSibling,
      createParent('FACEPLATE-LOADER', null),
      parent,
      createParent('DIV', null),
    ],
    tagName: 'DIV',
  };
  parent.parentElement = grandParent;
  const imageInsideSiblingLinkedWrapper = {
    closest: () => null,
    currentSrc: 'https://example.test/non-adjacent-sibling-linked-art.png',
    nextElementSibling: null,
    parentElement: parent,
    previousElementSibling: null,
    src: '',
    tagName: 'IMG',
  };

  assert.equal(hasNearbyAnchorSibling(imageInsideSiblingLinkedWrapper), true);
  assert.equal(
    getAssetReferrerHref(imageInsideSiblingLinkedWrapper),
    'https://www.example.test/post/non-adjacent-sibling',
  );
  assert.equal(describeAssetElement(imageInsideSiblingLinkedWrapper), null);
  assert.equal(
    describeReferrerAssetElement(imageInsideSiblingLinkedWrapper)?.referrerUrl,
    'https://www.example.test/post/non-adjacent-sibling',
  );
});

test('ignores assets whose ancestor within ten parent levels has an anchor sibling', () => {
  const linkedAncestor = {
    href: 'https://www.example.test/post/ancestor-sibling',
    tagName: 'a',
  };
  const tenthParent = {
    nextElementSibling: null,
    parentElement: null,
    previousElementSibling: linkedAncestor,
    tagName: 'DIV',
  };
  const ninthParent = createParent('DIV', tenthParent);
  const eighthParent = createParent('SECTION', ninthParent);
  const seventhParent = createParent('ARTICLE', eighthParent);
  const sixthParent = createParent('DIV', seventhParent);
  const fifthParent = createParent('DIV', sixthParent);
  const fourthParent = createParent('SECTION', fifthParent);
  const thirdParent = createParent('ARTICLE', fourthParent);
  const secondParent = createParent('DIV', thirdParent);
  const firstParent = createParent('DIV', secondParent);
  const imageInsideLinkedAncestorWrapper = {
    closest: () => null,
    currentSrc: 'https://cdn.example.test/ancestor-sibling-art.png',
    nextElementSibling: null,
    parentElement: firstParent,
    previousElementSibling: null,
    src: '',
    tagName: 'IMG',
  };

  assert.equal(hasNearbyAnchorSibling(imageInsideLinkedAncestorWrapper), true);
  assert.equal(
    getAssetReferrerHref(imageInsideLinkedAncestorWrapper),
    'https://www.example.test/post/ancestor-sibling',
  );
  assert.equal(describeAssetElement(imageInsideLinkedAncestorWrapper), null);
  assert.equal(
    describeReferrerAssetElement(imageInsideLinkedAncestorWrapper)?.referrerUrl,
    'https://www.example.test/post/ancestor-sibling',
  );
});

test('does not ignore assets from anchor siblings beyond ten parent levels', () => {
  const distantLinkedAncestor = {
    href: 'https://www.example.test/post/distant-ancestor-sibling',
    tagName: 'a',
  };
  const eleventhParent = {
    nextElementSibling: null,
    parentElement: null,
    previousElementSibling: distantLinkedAncestor,
    tagName: 'DIV',
  };
  const tenthParent = createParent('DIV', eleventhParent);
  const ninthParent = createParent('DIV', tenthParent);
  const eighthParent = createParent('SECTION', ninthParent);
  const seventhParent = createParent('ARTICLE', eighthParent);
  const sixthParent = createParent('DIV', seventhParent);
  const fifthParent = createParent('DIV', sixthParent);
  const fourthParent = createParent('SECTION', fifthParent);
  const thirdParent = createParent('ARTICLE', fourthParent);
  const secondParent = createParent('DIV', thirdParent);
  const firstParent = createParent('DIV', secondParent);
  const imageInsideDistantLinkedAncestorWrapper = {
    closest: () => null,
    currentSrc: 'https://cdn.example.test/distant-ancestor-sibling-art.png',
    nextElementSibling: null,
    parentElement: firstParent,
    previousElementSibling: null,
    src: '',
    tagName: 'IMG',
  };

  assert.equal(hasNearbyAnchorSibling(imageInsideDistantLinkedAncestorWrapper), false);
  assert.deepEqual(describeAssetElement(imageInsideDistantLinkedAncestorWrapper), {
    resolution: null,
    source: 'https://cdn.example.test/distant-ancestor-sibling-art.png',
    type: 'image',
  });
});

test('does not ignore assets from anchor siblings on document container tags', () => {
  const bodySibling = {
    href: 'https://www.example.test/post/body-sibling',
    tagName: 'a',
  };
  const body = {
    nextElementSibling: null,
    parentElement: null,
    previousElementSibling: bodySibling,
    tagName: 'BODY',
  };
  const firstParent = createParent('DIV', body);
  const imageInsideBodyWrapper = {
    closest: () => null,
    currentSrc: 'https://cdn.example.test/body-sibling-art.png',
    nextElementSibling: null,
    parentElement: firstParent,
    previousElementSibling: null,
    src: '',
    tagName: 'IMG',
  };

  assert.equal(hasNearbyAnchorSibling(imageInsideBodyWrapper), false);
  assert.deepEqual(describeAssetElement(imageInsideBodyWrapper), {
    resolution: null,
    source: 'https://cdn.example.test/body-sibling-art.png',
    type: 'image',
  });
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

test('ignores hidden media for asset and referrer badges', () => {
  const hiddenImage = {
    closest: () => null,
    currentSrc: 'https://cdn.example.test/hidden-art.png',
    src: '',
    tagName: 'IMG',
  };
  const hiddenLinkedImage = {
    closest: () => ({
      href: 'https://www.example.test/post/hidden',
      tagName: 'A',
    }),
    currentSrc: 'https://cdn.example.test/hidden-linked-art.png',
    src: '',
    tagName: 'IMG',
  };
  const restoreComputedStyle = stubComputedStyle({
    display: 'block',
    opacity: '0',
    visibility: 'visible',
  });

  try {
    assert.equal(describeAssetElement(hiddenImage), null);
    assert.equal(describeReferrerAssetElement(hiddenLinkedImage), null);
  } finally {
    restoreComputedStyle();
  }
});

function createParent(tagName, parentElement) {
  return {
    nextElementSibling: null,
    parentElement,
    previousElementSibling: null,
    tagName,
  };
}

function stubComputedStyle(style) {
  const originalGetComputedStyle = globalThis.getComputedStyle;

  globalThis.getComputedStyle = () => style;

  return () => {
    if (originalGetComputedStyle === undefined) {
      delete globalThis.getComputedStyle;

      return;
    }

    globalThis.getComputedStyle = originalGetComputedStyle;
  };
}
