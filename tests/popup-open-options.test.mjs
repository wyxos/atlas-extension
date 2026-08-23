import assert from 'node:assert/strict';
import test from 'node:test';

import { openExtensionOptions } from '../src/popup/open-options.js';

test('opens the extension options page', async () => {
  let calls = 0;
  const runtime = {
    openOptionsPage(callback) {
      calls += 1;
      callback();
    },
  };

  assert.deepEqual(await openExtensionOptions(runtime), { ok: true });
  assert.equal(calls, 1);
});

test('reports Chrome options API failures', async () => {
  const runtime = {
    lastError: { message: 'Options are blocked.' },
    openOptionsPage(callback) {
      callback();
    },
  };

  assert.deepEqual(await openExtensionOptions(runtime), {
    error: 'Options are blocked.',
    ok: false,
  });
});

test('reports when the Chrome options API is unavailable', async () => {
  assert.deepEqual(await openExtensionOptions(null), {
    error: 'Chrome options API is unavailable.',
    ok: false,
  });
});
