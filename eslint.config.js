import js from '@eslint/js';
import pluginVue from 'eslint-plugin-vue';

const browserGlobals = {
  document: 'readonly',
  fetch: 'readonly',
  MutationObserver: 'readonly',
  window: 'readonly',
};

const nodeGlobals = {
  Buffer: 'readonly',
  console: 'readonly',
  process: 'readonly',
  queueMicrotask: 'readonly',
  setTimeout: 'readonly',
  URL: 'readonly',
};

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
    ],
  },
  js.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['**/*.{js,mjs,vue}'],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: {
        ...browserGlobals,
        ...nodeGlobals,
      },
      sourceType: 'module',
    },
    rules: {
      'max-lines': ['error', {
        max: 500,
        skipBlankLines: false,
        skipComments: false,
      }],
      'vue/attributes-order': 'off',
      'vue/html-self-closing': 'off',
      'vue/max-attributes-per-line': 'off',
      'vue/multi-word-component-names': 'off',
      'vue/no-reserved-component-names': 'off',
      'vue/require-default-prop': 'off',
    },
  },
];
