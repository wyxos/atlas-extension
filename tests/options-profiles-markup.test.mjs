import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

const source = fs.readFileSync(
  path.resolve(import.meta.dirname, '../src/options/pages/Profiles.vue'),
  'utf8',
);

test('profiles page exposes asset source domain management controls', () => {
  assert.match(source, /atlas-source-domain/);
  assert.match(source, /atlas-source-filter/);
  assert.match(source, /activeDomain/);
  assert.match(source, /selectedProfile/);
  assert.match(source, /selectedProfileTab/);
  assert.match(source, /Asset/);
  assert.match(source, /Referrer/);
  assert.match(source, /imageSourcePreference/);
  assert.match(source, /highestSrcset/);
  assert.match(source, /addAssetSourceDomain/);
  assert.match(source, /loadAssetSourcePreferences/);
  assert.match(source, /removeAssetSourceDomain/);
  assert.match(source, /filteredDomains/);
  assert.match(source, /overflow-y-auto/);
  assert.match(source, /<ul/);
  assert.doesNotMatch(source, /@ui\/table/);
  assert.doesNotMatch(source, /<Table/);
});
