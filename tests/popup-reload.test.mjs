import assert from 'node:assert/strict';
import test from 'node:test';

import { requestExtensionReload } from '../src/popup/reload-extension.js';

test('popup reload sends a background reload request', async () => {
  const calls = [];
  const runtime = {
    sendMessage(message, callback) {
      calls.push(message);
      callback({ ok: true, payload: { reloading: true } });
    },
  };

  const result = await requestExtensionReload({ runtime });

  assert.deepEqual(result, { ok: true, reloading: true });
  assert.deepEqual(calls, [{ type: 'atlas-extension.reload-extension' }]);
});

test('popup reload reports runtime messaging errors', async () => {
  const runtime = {
    lastError: {
      message: 'The message port closed before a response was received.',
    },
    sendMessage(_message, callback) {
      callback();
    },
  };

  const result = await requestExtensionReload({ runtime });

  assert.deepEqual(result, {
    error: 'The message port closed before a response was received.',
    ok: false,
  });
});
