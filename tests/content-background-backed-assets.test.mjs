import assert from 'node:assert/strict';
import test from 'node:test';

import { describeAssetElement } from '../src/content/assets.js';

test('recovers low opacity images backed by visible matching background media', () => {
  const source = 'https://cdn.example.test/background-backed-art.jpg?name=large';
  const { backgroundElement, imageElement } = createBackgroundBackedImageFixture({
    backgroundSource: source,
    imageSource: source,
  });
  const restoreComputedStyle = stubComputedStyles(new Map([
    [imageElement, visibleStyle({ opacity: '0' })],
    [backgroundElement, visibleStyle({ backgroundImage: `url("${source}")` })],
  ]));

  try {
    assert.deepEqual(describeAssetElement(imageElement), {
      resolution: null,
      source,
      type: 'image',
    });
  } finally {
    restoreComputedStyle();
  }
});

test('does not recover low opacity images when background media differs', () => {
  const { backgroundElement, imageElement } = createBackgroundBackedImageFixture({
    backgroundSource: 'https://cdn.example.test/other-art.jpg',
    imageSource: 'https://cdn.example.test/background-backed-art.jpg',
  });
  const restoreComputedStyle = stubComputedStyles(new Map([
    [imageElement, visibleStyle({ opacity: '0' })],
    [backgroundElement, visibleStyle({
      backgroundImage: 'url("https://cdn.example.test/other-art.jpg")',
    })],
  ]));

  try {
    assert.equal(describeAssetElement(imageElement), null);
  } finally {
    restoreComputedStyle();
  }
});

test('does not recover low opacity images from low opacity background media', () => {
  const source = 'https://cdn.example.test/background-backed-art.jpg';
  const { backgroundElement, imageElement } = createBackgroundBackedImageFixture({
    backgroundSource: source,
    imageSource: source,
  });
  const restoreComputedStyle = stubComputedStyles(new Map([
    [imageElement, visibleStyle({ opacity: '0' })],
    [backgroundElement, visibleStyle({
      backgroundImage: `url("${source}")`,
      opacity: '0.25',
    })],
  ]));

  try {
    assert.equal(describeAssetElement(imageElement), null);
  } finally {
    restoreComputedStyle();
  }
});

function createBackgroundBackedImageFixture({
  backgroundSource,
  imageSource,
}) {
  const rect = {
    bottom: 360,
    height: 360,
    left: 0,
    right: 640,
    top: 0,
    width: 640,
  };
  const backgroundElement = {
    getBoundingClientRect: () => rect,
    parentElement: null,
    querySelectorAll: () => [],
    style: {},
    tagName: 'SPAN',
  };
  const imageElement = {
    closest: () => null,
    currentSrc: imageSource,
    getAttribute: (name) => (name === 'src' ? imageSource : null),
    getBoundingClientRect: () => rect,
    parentElement: null,
    src: imageSource,
    style: {},
    tagName: 'IMG',
  };
  const wrapper = {
    children: [backgroundElement, imageElement],
    parentElement: null,
    querySelectorAll: () => [backgroundElement, imageElement],
    style: {},
    tagName: 'DIV',
  };

  backgroundElement.parentElement = wrapper;
  imageElement.parentElement = wrapper;

  return {
    backgroundElement,
    backgroundSource,
    imageElement,
  };
}

function stubComputedStyles(stylesByElement) {
  const originalGetComputedStyle = globalThis.getComputedStyle;

  globalThis.getComputedStyle = (element) => stylesByElement.get(element) ?? visibleStyle();

  return () => {
    if (originalGetComputedStyle === undefined) {
      delete globalThis.getComputedStyle;

      return;
    }

    globalThis.getComputedStyle = originalGetComputedStyle;
  };
}

function visibleStyle(overrides = {}) {
  return {
    backgroundImage: 'none',
    display: 'block',
    opacity: '1',
    visibility: 'visible',
    ...overrides,
  };
}
