import js from '@eslint/js';

// Мінімальний flat config — тільки eslint:recommended, без плагінів
// понад @eslint/js (TECH.md §7, vanilla підхід поширюється й на
// dev-тулінг). Node-глобали прописані вручну замість пакета `globals`,
// щоб не тягнути ще одну залежність заради списку імен.
const nodeGlobals = {
  process: 'readonly',
  console: 'readonly',
  Buffer: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  fetch: 'readonly',
  AbortController: 'readonly',
  AbortSignal: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  __dirname: 'readonly',
};

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: nodeGlobals,
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    ignores: ['node_modules/', 'verify/'],
  },
];
