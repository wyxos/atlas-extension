import assert from 'node:assert/strict';
import test from 'node:test';

import { createBadgeFileActions } from '../src/content/badge-file-actions.js';

test('extracted file actions preserve open and delete behavior', async () => {
  const calls = [];
  const assetsById = new Map([['asset-1', { source: 'https://cdn.example.test/file.jpg' }]]);
  const badgeStatesById = new Map([['asset-1', { file: { id: 42 } }]]);
  const actions = createBadgeFileActions({
    assetsById,
    badgeStatesById,
    deleteFile: async (payload) => calls.push(['delete', payload]),
    forgetAssetSource: (source) => calls.push(['forget', source]),
    openFile: (payload) => calls.push(['open', payload]),
    replaceBadgeState: (id, state) => calls.push(['replace', id, state]),
    resolveFileId: (state) => state?.file?.id ?? null,
    shouldApplyResponse: () => true,
    updateBadgeState: (id, state) => calls.push(['update', id, state]),
  });

  actions.handleOpenFile({ id: 'asset-1' });
  await actions.handleDelete({ id: 'asset-1' });

  assert.deepEqual(calls, [
    ['open', { fileId: 42 }],
    ['update', 'asset-1', { isDeleting: true }],
    ['delete', { fileId: 42 }],
    ['forget', 'https://cdn.example.test/file.jpg'],
    ['replace', 'asset-1', {}],
  ]);
});
