import assert from 'node:assert/strict';
import test from 'node:test';

import {
  closeTabModes,
  closeTabPreferencesKey,
  loadCloseTabModeForSiteDomain,
  normalizeSiteDomain,
  saveCloseTabModeForSiteDomain,
} from '../src/shared/close-tab-preferences.js';

test('normalizes site domains from urls and host inputs', () => {
  assert.equal(normalizeSiteDomain('https://www.YouTube.com/watch?v=1'), 'youtube.com');
  assert.equal(normalizeSiteDomain('x.com'), 'x.com');
  assert.equal(normalizeSiteDomain(' https://mobile.twitter.com/post/123 '), 'mobile.twitter.com');
  assert.equal(normalizeSiteDomain('chrome-extension://abc/options.html'), null);
  assert.equal(normalizeSiteDomain('not a host'), null);
});

test('loads default off mode and saves modes per site domain', async () => {
  const writes = [];
  const storage = {
    async get(key) {
      assert.equal(key, closeTabPreferencesKey);

      return {
        [closeTabPreferencesKey]: {
          modesBySiteDomain: {
            'x.com': closeTabModes.afterQueue,
            'youtube.com': 'invalid',
          },
          version: 1,
        },
      };
    },
    async set(value) {
      writes.push(value);
    },
  };

  assert.equal(
    await loadCloseTabModeForSiteDomain('https://www.x.com/post/123', storage),
    closeTabModes.afterQueue,
  );
  assert.equal(
    await loadCloseTabModeForSiteDomain('https://youtube.com/watch?v=1', storage),
    closeTabModes.off,
  );

  await saveCloseTabModeForSiteDomain('https://www.youtube.com/watch?v=1', closeTabModes.onComplete, storage);

  assert.deepEqual(writes, [{
    [closeTabPreferencesKey]: {
      modesBySiteDomain: {
        'x.com': closeTabModes.afterQueue,
        'youtube.com': closeTabModes.onComplete,
      },
      version: 1,
    },
  }]);
});
