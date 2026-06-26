import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collectDeviantArtBatchItems,
  deviantArtReferrerForFileIndex,
  readCurrentDeviantArtBatchItem,
  resolveDeviantArtBatchContext,
} from '../src/content/batch-providers/deviantart.js';

test('detects DeviantArt batch context from deviation navigation controls', () => {
  const documentContext = {
    querySelectorAll(selector) {
      return selector.includes('button') ? [createButton('Next')] : [];
    },
  };

  assert.deepEqual(resolveDeviantArtBatchContext({
    documentContext,
    locationContext: new URL('https://www.deviantart.com/artist/art/title-123'),
  }), {
    available: true,
    provider: 'deviantart',
  });
  assert.equal(resolveDeviantArtBatchContext({
    documentContext,
    locationContext: new URL('https://example.test/artist/art/title-123'),
  }), null);
});

test('formats DeviantArt referrers with explicit file indexes', () => {
  assert.equal(
    deviantArtReferrerForFileIndex(
      'https://www.deviantart.com/artist/art/title-123',
      1,
    ),
    'https://www.deviantart.com/artist/art/title-123?file=1',
  );
  assert.equal(
    deviantArtReferrerForFileIndex(
      'https://www.deviantart.com/artist/art/title-123?file=2&utm_source=test',
      3,
    ),
    'https://www.deviantart.com/artist/art/title-123?file=3&utm_source=test',
  );
});

test('reads the current DeviantArt image from src instead of transformed currentSrc', () => {
  const item = readCurrentDeviantArtBatchItem({
    documentContext: {
      images: [
        createImage({
          currentSrc: 'https://images.example.test/sidebar-preview.jpg',
          height: 92,
          src: 'https://images.example.test/sidebar-original.jpg',
          width: 92,
        }),
        createImage({
          currentSrc: 'https://images.example.test/file-2.jpg/v1/fill/w_800/file-2-pre.jpg',
          height: 707,
          naturalHeight: 1400,
          naturalWidth: 1000,
          src: 'https://images.example.test/file-2.jpg?token=abc',
          width: 1131,
        }),
      ],
    },
    locationContext: new URL('https://www.deviantart.com/artist/art/title-123?file=2'),
  });

  assert.deepEqual(item, {
    asset: {
      resolution: '1000x1400',
      source: 'https://images.example.test/file-2.jpg?token=abc',
      type: 'image',
    },
    referrerUrl: 'https://www.deviantart.com/artist/art/title-123?file=2',
    source: 'www.deviantart.com',
  });
});

test('collects DeviantArt batch items and restores the starting file', async () => {
  let currentFile = 2;
  const files = {
    1: createImage({
      height: 700,
      naturalHeight: 1400,
      naturalWidth: 1000,
      src: 'https://images.example.test/file-1.jpg',
      width: 1000,
    }),
    2: createImage({
      height: 800,
      naturalHeight: 1600,
      naturalWidth: 1200,
      src: 'https://images.example.test/file-2.jpg',
      width: 1200,
    }),
  };
  const locationContext = {
    get href() {
      return currentFile === 1
        ? 'https://www.deviantart.com/artist/art/title-123'
        : `https://www.deviantart.com/artist/art/title-123?file=${currentFile}`;
    },
    hostname: 'www.deviantart.com',
  };
  const documentContext = {
    get images() {
      return [files[currentFile]];
    },
    querySelectorAll() {
      return [
        currentFile > 1 ? createButton('Previous', () => { currentFile -= 1; }) : null,
        currentFile < 2 ? createButton('Next', () => { currentFile += 1; }) : null,
      ].filter(Boolean);
    },
  };

  const items = await collectDeviantArtBatchItems({
    documentContext,
    locationContext,
    waitForChange: async () => true,
  });

  assert.deepEqual(items, [
    {
      asset: {
        resolution: '1000x1400',
        source: 'https://images.example.test/file-1.jpg',
        type: 'image',
      },
      referrerUrl: 'https://www.deviantart.com/artist/art/title-123?file=1',
      source: 'www.deviantart.com',
    },
    {
      asset: {
        resolution: '1200x1600',
        source: 'https://images.example.test/file-2.jpg',
        type: 'image',
      },
      referrerUrl: 'https://www.deviantart.com/artist/art/title-123?file=2',
      source: 'www.deviantart.com',
    },
  ]);
  assert.equal(currentFile, 2);
});

test('collects DeviantArt batch items from thumbnails when navigation skips files', async () => {
  let currentFile = 1;
  const files = {
    1: createImage({
      height: 700,
      naturalHeight: 390,
      naturalWidth: 695,
      src: 'https://images.example.test/file-1.jpg',
      width: 1200,
    }),
    2: createImage({
      height: 707,
      naturalHeight: 412,
      naturalWidth: 659,
      src: 'https://images.example.test/file-2.jpg',
      width: 1131,
    }),
    3: createImage({
      height: 730,
      naturalHeight: 425,
      naturalWidth: 638,
      src: 'https://images.example.test/file-3.jpg',
      width: 1095,
    }),
  };
  const locationContext = {
    get href() {
      return `https://www.deviantart.com/artist/art/title-123?file=${currentFile}`;
    },
    hostname: 'www.deviantart.com',
  };
  const thumbnailButtons = [1, 2, 3].map((fileIndex) => createButton('', () => {
    currentFile = fileIndex;
  }));
  const thumbnails = [1, 2, 3].map((fileIndex, index) => createImage({
    button: thumbnailButtons[index],
    height: 36,
    section: {
      tagName: 'SECTION',
      textContent: 'All Images',
    },
    src: `https://images.example.test/file-${fileIndex}-thumb.jpg`,
    width: 36,
  }));
  const documentContext = {
    get images() {
      return [files[currentFile], ...thumbnails];
    },
    querySelectorAll(selector) {
      if (selector === 'section img') {
        return thumbnails;
      }

      return [];
    },
  };

  const items = await collectDeviantArtBatchItems({
    documentContext,
    locationContext,
    waitForChange: async () => true,
  });

  assert.deepEqual(items.map((item) => ({
    referrerUrl: item.referrerUrl,
    source: item.asset.source,
  })), [
    {
      referrerUrl: 'https://www.deviantart.com/artist/art/title-123?file=1',
      source: 'https://images.example.test/file-1.jpg',
    },
    {
      referrerUrl: 'https://www.deviantart.com/artist/art/title-123?file=2',
      source: 'https://images.example.test/file-2.jpg',
    },
    {
      referrerUrl: 'https://www.deviantart.com/artist/art/title-123?file=3',
      source: 'https://images.example.test/file-3.jpg',
    },
  ]);
  assert.equal(currentFile, 1);
});

function createButton(label, onClick = () => {}) {
  return {
    disabled: false,
    click: onClick,
    getAttribute(name) {
      return name === 'aria-label' ? label : null;
    },
    getBoundingClientRect() {
      return {
        height: 44,
        width: 70,
      };
    },
  };
}

function createImage({
  button = null,
  currentSrc = '',
  height,
  naturalHeight,
  naturalWidth,
  section = null,
  src,
  width,
}) {
  return {
    currentSrc,
    naturalHeight: naturalHeight ?? height,
    naturalWidth: naturalWidth ?? width,
    src,
    getAttribute(name) {
      return name === 'src' ? src : null;
    },
    closest(selector) {
      if (selector === 'button,[role="button"]') {
        return button;
      }

      if (selector === 'section') {
        return section;
      }

      return null;
    },
    getBoundingClientRect() {
      return {
        height,
        width,
      };
    },
  };
}
