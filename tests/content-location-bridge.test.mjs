import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

const source = fs.readFileSync(
  path.resolve(import.meta.dirname, '../src/content/location-bridge.js'),
  'utf8',
);

test('location bridge dispatches page-world SPA navigation events', () => {
  assert.match(source, /atlas-extension-location-change/);
  assert.match(source, /pushState/);
  assert.match(source, /replaceState/);
  assert.match(source, /dispatchEvent/);
});
