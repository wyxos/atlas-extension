import assert from 'node:assert/strict';
import test from 'node:test';

import { listAssetElements } from '../src/content/asset-scanner.js';

test('lists media elements inside open shadow roots', () => {
  const shadowVideo = {
    matches: (selector) => selector === 'img, video, audio',
    querySelectorAll: () => [],
    tagName: 'VIDEO',
  };
  const shadowRoot = {
    querySelectorAll: (selector) => (selector === 'img, video, audio' ? [shadowVideo] : []),
  };
  const playerHost = {
    matches: () => false,
    querySelectorAll: () => [],
    shadowRoot,
    tagName: 'CUSTOM-PLAYER',
  };
  const root = {
    matches: () => false,
    querySelectorAll: (selector) => (selector === '*' ? [playerHost] : []),
  };

  assert.deepEqual(listAssetElements(root, 'img, video, audio'), [shadowVideo]);
});

test('lists media elements inside the root element shadow root', () => {
  const shadowImage = {
    matches: (selector) => selector === 'img, video, audio',
    querySelectorAll: () => [],
    tagName: 'IMG',
  };
  const shadowRoot = {
    querySelectorAll: (selector) => (selector === 'img, video, audio' ? [shadowImage] : []),
  };
  const root = {
    matches: () => false,
    querySelectorAll: () => [],
    shadowRoot,
  };

  assert.deepEqual(listAssetElements(root, 'img, video, audio'), [shadowImage]);
});
