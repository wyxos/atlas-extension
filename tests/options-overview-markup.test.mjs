import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

const source = fs.readFileSync(
  path.resolve(import.meta.dirname, '../src/options/pages/Overview.vue'),
  'utf8',
);

test('options overview is a Desktop diagnostics and pairing surface only', () => {
  for (const expected of [
    'requestDesktopDiagnostics',
    'requestDesktopPairing',
    'requestDesktopReconnect',
    'requestDesktopUnpair',
    'Cancel pairing',
    'Runtime policy revision',
    'Last keepalive',
    'Last event received',
    'onChanged\\?\\.addListener',
  ]) {
    assert.match(source, new RegExp(expected));
  }

  assert.doesNotMatch(source, /api.?key|asset.?profile|settings.?sync/i);
});

test('manifest requires the Chrome WebSocket service-worker lifetime baseline', () => {
  const manifest = JSON.parse(fs.readFileSync(
    path.resolve(import.meta.dirname, '../manifest.json'),
    'utf8',
  ));

  assert.equal(manifest.minimum_chrome_version, '116');
});
