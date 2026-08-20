import assert from 'node:assert/strict';
import test from 'node:test';

import { assetSourcePreferencesKey } from '../src/shared/asset-source-preferences.js';
import { batchProviderPreferencesKey } from '../src/content/batch-provider-preferences.js';
import { closeTabPreferencesKey } from '../src/shared/close-tab-preferences.js';
import { overlayPlacementPreferencesKey } from '../src/shared/overlay-placement-preferences.js';
import {
  applySettingsBundle,
  buildSettingsBundle,
  mergeSettingsBundles,
  normalizeSettingsBundle,
  settingsBundleSchemaVersion,
} from '../src/shared/settings-bundle.js';

test('builds a Desktop runtime-policy bundle from browser behavior settings only', async () => {
  const storage = createStorage({
    [assetSourcePreferencesKey]: { domains: ['reddit.com'], version: 3 },
    [batchProviderPreferencesKey]: { deviantart: true },
    [closeTabPreferencesKey]: { modesBySiteDomain: { 'reddit.com': 'after_queue' }, version: 1 },
    [overlayPlacementPreferencesKey]: {
      positionsBySiteDomain: { 'reddit.com': { xRatio: 0.25, yRatio: 0.75 } },
      version: 1,
    },
    atlasDesktopConnection: {
      clientId: 'client-id',
      clientToken: 'secret-token',
    },
  });

  const bundle = await buildSettingsBundle({ storage });

  assert.equal(bundle.schemaVersion, settingsBundleSchemaVersion);
  assert.deepEqual(Object.keys(bundle.settings).sort(), [
    'assetSourcePreferences',
    'batchProviderPreferences',
    'closeTabPreferences',
    'overlayPlacementPreferences',
  ]);
  assert.doesNotMatch(JSON.stringify(bundle), /client-id|secret-token|connection/i);
});

test('strips legacy connection profiles and secrets while normalizing policy', () => {
  const normalized = normalizeSettingsBundle({
    schemaVersion: settingsBundleSchemaVersion,
    settings: {
      connection: {
        profiles: { live: { apiKey: 'legacy-secret' } },
      },
    },
  });

  assert.equal(Object.hasOwn(normalized.settings, 'connection'), false);
  assert.doesNotMatch(JSON.stringify(normalized), /legacy-secret/);
});

test('applies Desktop policy without touching pairing credentials', async () => {
  const storage = createStorage({
    atlasDesktopConnection: {
      clientId: 'client-id',
      clientToken: 'secret-token',
    },
  });

  await applySettingsBundle(createSettingsBundle({
    assetDomains: ['reddit.com'],
    batchProviders: { deviantart: true },
    closeTabModes: { 'reddit.com': 'on_complete' },
  }), { storage });

  const values = storage.values();
  assert.equal(values.atlasDesktopConnection.clientToken, 'secret-token');
  assert.deepEqual(values[assetSourcePreferencesKey].domains, ['reddit.com']);
  assert.deepEqual(values[batchProviderPreferencesKey], { deviantart: true });
  assert.deepEqual(values[closeTabPreferencesKey].modesBySiteDomain, {
    'reddit.com': 'on_complete',
  });
  assert.deepEqual(values[overlayPlacementPreferencesKey].positionsBySiteDomain, {});
});

test('merges policy values while keeping local overlap values', () => {
  const merged = mergeSettingsBundles(
    createSettingsBundle({
      assetDomains: ['reddit.com'],
      batchProviders: { reddit: true },
      closeTabModes: { 'reddit.com': 'after_queue' },
    }),
    createSettingsBundle({
      assetDomains: ['deviantart.com', 'reddit.com'],
      batchProviders: { deviantart: true },
      closeTabModes: { 'reddit.com': 'on_complete', 'x.com': 'on_complete' },
    }),
  );

  assert.deepEqual(merged.settings.assetSourcePreferences.domains, ['deviantart.com', 'reddit.com']);
  assert.deepEqual(merged.settings.batchProviderPreferences, { deviantart: true, reddit: true });
  assert.deepEqual(merged.settings.closeTabPreferences.modesBySiteDomain, {
    'reddit.com': 'after_queue',
    'x.com': 'on_complete',
  });
});

function createStorage(initialValues = {}) {
  const stored = cloneJson(initialValues);

  return {
    async get(key) {
      if (Array.isArray(key)) {
        return Object.fromEntries(key.map((item) => [item, stored[item]]));
      }
      return { [key]: stored[key] };
    },
    async set(nextValues) {
      Object.assign(stored, cloneJson(nextValues));
    },
    values: () => cloneJson(stored),
  };
}

function createSettingsBundle({ assetDomains = [], batchProviders = {}, closeTabModes = {} } = {}) {
  return {
    schemaVersion: settingsBundleSchemaVersion,
    settings: {
      assetSourcePreferences: { domains: assetDomains, version: 3 },
      batchProviderPreferences: batchProviders,
      closeTabPreferences: { modesBySiteDomain: closeTabModes, version: 1 },
    },
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}
