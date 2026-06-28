import path from 'node:path';
import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

const rootDirectory = fileURLToPath(new URL('.', import.meta.url));
const allowedBuildTargets = new Set(['background', 'content', 'location-bridge', 'options']);
const buildTarget = process.env.ATLAS_EXTENSION_BUILD_TARGET ?? 'options';
const strictModeDirective = "'use strict';";

if (!allowedBuildTargets.has(buildTarget)) {
  throw new Error(`Unsupported Atlas extension build target: ${buildTarget}`);
}

function resolveInput() {
  const inputs = {
    content: path.resolve(rootDirectory, 'src/content/main.js'),
    'location-bridge': path.resolve(rootDirectory, 'src/content/location-bridge.js'),
    background: path.resolve(rootDirectory, 'src/background/main.js'),
    options: path.resolve(rootDirectory, 'options.html'),
    popup: path.resolve(rootDirectory, 'popup.html'),
  };

  if (buildTarget === 'background') {
    return { background: inputs.background };
  }

  if (buildTarget === 'content') {
    return { content: inputs.content };
  }

  if (buildTarget === 'location-bridge') {
    return { 'location-bridge': inputs['location-bridge'] };
  }

  return {
    options: inputs.options,
    popup: inputs.popup,
  };
}

function resolveOutput() {
  const output = {
    entryFileNames: 'assets/[name].js',
  };

  if (['background', 'content', 'location-bridge'].includes(buildTarget)) {
    output.inlineDynamicImports = true;
  }

  return output;
}

function strictContentScriptPlugin() {
  return {
    name: 'atlas-extension-strict-content-script',
    generateBundle(_options, bundle) {
      if (buildTarget !== 'content') {
        return;
      }

      const contentChunk = bundle['assets/content.js'];

      if (contentChunk?.type !== 'chunk' || contentChunk.code.startsWith(strictModeDirective)) {
        return;
      }

      contentChunk.code = `${strictModeDirective}\n${contentChunk.code}`;
    },
  };
}

export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      input: resolveInput(),
      output: resolveOutput(),
    },
  },
  plugins: [vue(), tailwindcss(), strictContentScriptPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(rootDirectory, 'src'),
      '@ui': path.resolve(rootDirectory, 'src/components/ui'),
    },
  },
});
