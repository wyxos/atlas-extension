import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

const source = fs.readFileSync(
  path.resolve(import.meta.dirname, '../src/content/ReactionUpdateDialog.vue'),
  'utf8',
);
const referrerOpenDialogSource = fs.readFileSync(
  path.resolve(import.meta.dirname, '../src/content/ReferrerOpenDialog.vue'),
  'utf8',
);
const extensionDialogSource = fs.readFileSync(
  path.resolve(import.meta.dirname, '../src/content/ExtensionDialog.vue'),
  'utf8',
);

test('reaction update dialog exposes the expected choices', () => {
  assert.match(source, /ExtensionDialog/);
  assert.match(source, /Update reaction only/);
  assert.match(source, /React \+ redownload/);
  assert.match(source, /Cancel/);
});

test('content dialogs use the extension-owned dialog instead of the shared Reka alert dialog', () => {
  assert.doesNotMatch(source, /@\/components\/ui\/alert-dialog/);
  assert.doesNotMatch(referrerOpenDialogSource, /@\/components\/ui\/alert-dialog/);
  assert.match(source, /ExtensionDialog/);
  assert.match(referrerOpenDialogSource, /ExtensionDialog/);
});

test('extension dialog owns modal semantics inside the extension shadow root', () => {
  assert.match(extensionDialogSource, /role="alertdialog"/);
  assert.match(extensionDialogSource, /aria-modal="true"/);
  assert.match(extensionDialogSource, /data-slot="alert-dialog-overlay"/);
  assert.match(extensionDialogSource, /data-slot="alert-dialog-content"/);
  assert.match(extensionDialogSource, /event\.key === "Escape"/);
  assert.match(extensionDialogSource, /event\.key !== "Tab"/);
});
