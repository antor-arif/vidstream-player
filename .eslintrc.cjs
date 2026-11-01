/* ESLint 8 config for `npm run lint` (eslint src --ext .ts,.tsx) */
module.exports = {
  root: true,
  env: { browser: true, es2022: true },
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  ignorePatterns: ['dist/', 'node_modules/'],
  rules: {
    // hls.js / dash.js are optional peers loaded at runtime and typed loosely on purpose
    '@typescript-eslint/no-explicit-any': 'off',
    // Public API uses `Function` for event handlers (VidstreamPlayerInstance.on/off/once)
    '@typescript-eslint/ban-types': ['error', { types: { Function: false }, extendDefaults: true }],
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    // Intentional best-effort try/catch blocks around browser APIs
    'no-empty': ['error', { allowEmptyCatch: true }],
  },
};
