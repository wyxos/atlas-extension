import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeDownloadEventPayload } from '../src/background/reverb-client.js';

test('normalizes download progress events for content tabs', () => {
  assert.deepEqual(
    normalizeDownloadEventPayload({
      data: {
        asset_url: 'https://cdn.example.test/media/art.jpg',
        downloaded_at: '2025-01-02T03:04:05',
        file: {
          atlas_url: 'https://atlas.test/browse/file/123',
          id: 123,
        },
        fileId: 123,
        percent: 42,
        referrer_url: 'https://www.example.test/post/123',
        reaction: 'like',
        status: 'downloading',
      },
      event: 'DownloadTransferProgressUpdated',
    }),
    {
      assetUrl: 'https://cdn.example.test/media/art.jpg',
      download: {
        downloaded_at: '2025-01-02T03:04:05',
        file_id: 123,
        progress_percent: 42,
        status: 'downloading',
      },
      file: {
        atlas_url: 'https://atlas.test/browse/file/123',
        id: 123,
      },
      referrerUrl: 'https://www.example.test/post/123',
      reaction: { type: 'like' },
    },
  );
});
