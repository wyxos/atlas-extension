import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveCurrentReaction,
  resolveDownloadActionForReaction,
} from '../src/content/reaction-download-action.js';

test('detects the current stored reaction state', () => {
  assert.equal(resolveCurrentReaction({ reaction: { type: 'love' } }), 'love');
  assert.equal(resolveCurrentReaction({ reaction: 'like' }), 'like');
  assert.equal(resolveCurrentReaction({ blacklisted_at: '2026-06-27T10:00:00Z' }), 'blacklist');
  assert.equal(resolveCurrentReaction({}), null);
});

test('maps re-reaction dialog choices to download actions', async () => {
  const baseRequest = {
    asset: {
      source: 'https://cdn.example.test/file.jpg',
    },
    currentState: {
      reaction: {
        type: 'like',
      },
    },
    event: {
      type: 'love',
    },
  };

  assert.equal(await resolveDownloadActionForReaction({
    ...baseRequest,
    confirmReactionUpdate: async () => 'update-only',
  }), 'skip');
  assert.equal(await resolveDownloadActionForReaction({
    ...baseRequest,
    confirmReactionUpdate: async () => 'redownload',
  }), 'force');
  assert.equal(await resolveDownloadActionForReaction({
    ...baseRequest,
    confirmReactionUpdate: async () => 'cancel',
  }), null);
  assert.equal(await resolveDownloadActionForReaction({
    ...baseRequest,
    currentState: {},
    confirmReactionUpdate: async () => {
      throw new Error('dialog should not open');
    },
  }), undefined);
});
