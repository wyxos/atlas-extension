import assert from 'node:assert/strict';
import test from 'node:test';

import {
  copyCurrentWindowTabLinksToClipboard,
  openClipboardLinksInCurrentWindow,
} from '../src/popup/tab-links.js';

test('popup copies current-window web tab links to the clipboard in tab order', async () => {
  const calls = [];
  const clipboard = {
    async writeText(text) {
      calls.push(['writeText', text]);
    },
  };
  const tabsApi = {
    query(query, callback) {
      calls.push(['query', query]);
      callback([
        { id: 12, index: 2, url: 'chrome://extensions' },
        { id: 10, index: 0, url: 'https://first.example.test/page' },
        { id: 11, index: 1, url: 'http://second.example.test/path' },
      ]);
    },
  };

  const result = await copyCurrentWindowTabLinksToClipboard({ clipboard, tabsApi });

  assert.deepEqual(result, {
    copied: 2,
    ok: true,
    skipped: 1,
  });
  assert.deepEqual(calls, [
    ['query', { currentWindow: true }],
    ['writeText', [
      'https://first.example.test/page',
      'http://second.example.test/path',
    ].join('\n')],
  ]);
});

test('popup opens clipboard web links as inactive tabs in the current window', async () => {
  const calls = [];
  const clipboard = {
    async readText() {
      calls.push(['readText']);

      return [
        ' https://first.example.test/page ',
        '',
        'not a url',
        'http://second.example.test/path',
        'chrome://extensions',
      ].join('\n');
    },
  };
  const tabsApi = {
    create(createProperties, callback) {
      calls.push(['create', createProperties]);
      callback({ id: 100 + calls.length });
    },
    query(query, callback) {
      calls.push(['query', query]);
      callback([{ id: 42, windowId: 7 }]);
    },
  };

  const result = await openClipboardLinksInCurrentWindow({ clipboard, tabsApi });

  assert.deepEqual(result, {
    ok: true,
    opened: 2,
    skipped: 3,
  });
  assert.deepEqual(calls, [
    ['readText'],
    ['query', { active: true, currentWindow: true }],
    ['create', {
      active: false,
      url: 'https://first.example.test/page',
      windowId: 7,
    }],
    ['create', {
      active: false,
      url: 'http://second.example.test/path',
      windowId: 7,
    }],
  ]);
});

test('popup reports when the clipboard does not contain web links', async () => {
  const clipboard = {
    async readText() {
      return 'chrome://extensions\nnot a url\n';
    },
  };
  const tabsApi = {
    create() {},
    query(_query, callback) {
      callback([{ id: 42, windowId: 7 }]);
    },
  };

  const result = await openClipboardLinksInCurrentWindow({ clipboard, tabsApi });

  assert.deepEqual(result, {
    error: 'Clipboard does not contain any HTTP(S) links.',
    ok: false,
    skipped: 3,
  });
});
