import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

const appSource = fs.readFileSync(
  path.resolve(import.meta.dirname, '../src/options/App.vue'),
  'utf8',
);
const routerSource = fs.readFileSync(
  path.resolve(import.meta.dirname, '../src/options/router.js'),
  'utf8',
);
const settingsSource = fs.existsSync(path.resolve(import.meta.dirname, '../src/options/pages/Settings.vue'))
  ? fs.readFileSync(path.resolve(import.meta.dirname, '../src/options/pages/Settings.vue'), 'utf8')
  : '';

test('options navigation exposes a settings page', () => {
  assert.match(appSource, /Settings/);
  assert.doesNotMatch(appSource, />\s*Global\s*</);
  assert.match(routerSource, /Settings/);
  assert.match(routerSource, /\/settings/);
});

test('app mounts the shadcn-vue sonner toaster', () => {
  assert.match(appSource, /vue-sonner\/style\.css/);
  assert.match(appSource, /from "vue-sonner"/);
  assert.match(appSource, /@ui\/sonner/);
  assert.match(appSource, /<Toaster/);
  assert.match(appSource, /position="bottom-right"/);
});

test('app copy describes extension settings instead of only connection setup', () => {
  assert.match(appSource, /Manage Atlas extension settings\./);
  assert.doesNotMatch(appSource, /Configure the Atlas connection\./);
});

test('app reports background settings sync results with toasts', () => {
  assert.match(appSource, /settingsSyncPreferencesKey/);
  assert.match(appSource, /chrome\.storage\.onChanged\.addListener/);
  assert.match(appSource, /settingsSyncStatuses\.conflict/);
  assert.match(appSource, /Settings conflict detected\./);
  assert.match(appSource, /toast\.success/);
  assert.match(appSource, /toast\.error/);
});

test('settings page exposes import export upload download and sync controls', () => {
  assert.match(settingsSource, /Export/);
  assert.match(settingsSource, /Import/);
  assert.match(settingsSource, /Upload/);
  assert.match(settingsSource, /Download/);
  assert.match(settingsSource, /Sync/);
  assert.match(settingsSource, /settings-file-input/);
  assert.match(settingsSource, /setSettingsSyncEnabled/);
  assert.match(settingsSource, /uploadSettingsToRemote/);
  assert.match(settingsSource, /downloadSettingsFromRemote/);
});

test('settings page exposes sync conflict resolution actions', () => {
  assert.match(settingsSource, /syncConflict/);
  assert.match(settingsSource, /Settings conflict/);
  assert.match(settingsSource, /Download from Atlas/);
  assert.match(settingsSource, /Upload local/);
  assert.match(settingsSource, /Merge/);
  assert.match(settingsSource, /mergeSettingsWithRemote/);
});

test('settings sync actions notify success and failure with toasts', () => {
  assert.match(settingsSource, /from "vue-sonner"/);
  assert.match(settingsSource, /toast\.success/);
  assert.match(settingsSource, /toast\.error/);
});
