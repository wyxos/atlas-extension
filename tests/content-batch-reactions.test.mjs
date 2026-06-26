import assert from 'node:assert/strict';
import test from 'node:test';

import { stateWithBatchContext } from '../src/content/batch-reactions.js';

test('batch presentation follows provider-level state instead of old per-asset state', () => {
  assert.deepEqual(
    stateWithBatchContext({
      batch: {
        available: true,
        checked: true,
      },
      reaction: { type: 'like' },
    }, {
      provider: 'deviantart',
    }, false),
    {
      batch: {
        available: true,
        checked: false,
      },
      reaction: {
        type: 'like',
      },
    },
  );

  assert.deepEqual(
    stateWithBatchContext({
      batch: {
        available: true,
        checked: false,
      },
    }, {
      provider: 'deviantart',
    }, true),
    {
      batch: {
        available: true,
        checked: true,
      },
    },
  );
});
