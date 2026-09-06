/** ESLint 設定。ブラウザ向け ES Modules として静的検査を行う。 */
export default [
  {
    files: ['js/**/*.js', 'tools/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        window: 'readonly', document: 'readonly', navigator: 'readonly',
        localStorage: 'readonly', console: 'readonly', URL: 'readonly',
        URLSearchParams: 'readonly', TextEncoder: 'readonly', TextDecoder: 'readonly',
        Uint8Array: 'readonly', btoa: 'readonly', atob: 'readonly', process: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['error', { args: 'after-used' }],
      'no-undef': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
    },
  },
];
