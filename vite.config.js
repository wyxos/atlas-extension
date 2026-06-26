import path from 'node:path';
import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

const rootDirectory = fileURLToPath(new URL('.', import.meta.url));
const allowedBuildTargets = new Set(['background', 'content', 'location-bridge', 'options']);
const buildTarget = process.env.ATLAS_EXTENSION_BUILD_TARGET ?? 'options';

if (!allowedBuildTargets.has(buildTarget)) {
  throw new Error(`Unsupported Atlas extension build target: ${buildTarget}`);
}

function resolveInput() {
  const inputs = {
    content: path.resolve(rootDirectory, 'src/content/main.js'),
    'location-bridge': path.resolve(rootDirectory, 'src/content/location-bridge.js'),
    background: path.resolve(rootDirectory, 'src/background/main.js'),
    options: path.resolve(rootDirectory, 'options.html'),
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

  return { options: inputs.options };
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

export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      input: resolveInput(),
      output: resolveOutput(),
    },
  },
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(rootDirectory, 'src'),
      '@ui': path.resolve(rootDirectory, 'src/components/ui'),
    },
  },
});
