import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');

test('prefixes the emitted content script with a strict-mode directive', async () => {
  const config = await loadViteConfigForTarget('content');
  const strictPlugin = config.plugins.find((plugin) => plugin.name === 'atlas-extension-strict-content-script');
  const bundle = {
    'assets/content.js': {
      code: 'const value = 1;',
      fileName: 'assets/content.js',
      type: 'chunk',
    },
  };

  strictPlugin.generateBundle({}, bundle);

  assert.equal(bundle['assets/content.js'].code, "'use strict';\nconst value = 1;");
});

test('builds the popup with the extension pages target', async () => {
  const config = await loadViteConfigForTarget('options');

  assert.equal(config.build.rollupOptions.input.popup, path.join(root, 'popup.html'));
});

async function loadViteConfigForTarget(target) {
  const previousTarget = process.env.ATLAS_EXTENSION_BUILD_TARGET;

  process.env.ATLAS_EXTENSION_BUILD_TARGET = target;

  try {
    const configUrl = pathToFileURL(path.join(root, 'vite.config.js'));
    configUrl.search = `?target=${target}&test=${Date.now()}`;

    const module = await import(configUrl.href);

    return module.default;
  } finally {
    if (previousTarget === undefined) {
      delete process.env.ATLAS_EXTENSION_BUILD_TARGET;
    } else {
      process.env.ATLAS_EXTENSION_BUILD_TARGET = previousTarget;
    }
  }
}
