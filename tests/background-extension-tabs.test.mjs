import assert from 'node:assert/strict';
import test from 'node:test';

import { showExtensionReloadNotice } from '../src/background/extension-reload.js';
import { reloadAllExtensionTabs } from '../src/background/extension-tabs.js';

test('reload all action reloads loaded HTTP tabs and skips idle or browser pages', async () => {
  const calls = [];
  const result = await reloadAllExtensionTabs({
    runtime: {},
    tabsApi: {
      query(query, callback) {
        calls.push(['query', query]);
        callback([
          { id: 61, status: 'complete', url: 'https://media.example.test/one' },
          { id: 62, status: 'complete', url: 'http://media.example.test/two' },
          { id: 63, status: 'complete', url: 'brave://extensions/' },
          { discarded: true, id: 64, status: 'unloaded', url: 'https://media.example.test/sleeping' },
          { frozen: true, id: 65, status: 'complete', url: 'https://media.example.test/frozen' },
          { discarded: false, id: 66, status: 'unloaded', url: 'https://media.example.test/lazy' },
        ]);
      },
      reload(tabId, options, callback) {
        calls.push(['reload', tabId, options]);
        callback();
      },
    },
  });

  assert.deepEqual(result, { reloaded: 2 });
  assert.deepEqual(calls, [
    ['query', {}],
    ['reload', 61, {}],
    ['reload', 62, {}],
  ]);
});

test('reload dialog exposes dismiss, single-tab, and explicit bulk actions', () => {
  const source = showExtensionReloadNotice.toString();

  assert.match(source, /Dismiss/);
  assert.match(source, /Reload tab/);
  assert.match(source, /Reload all active tabs/);
  assert.match(source, /runtime\?\.sendMessage/);
});
