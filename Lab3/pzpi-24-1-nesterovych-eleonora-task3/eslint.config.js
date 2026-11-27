'use strict';

// Налаштування статичного аналізатора ESLint (запуск: npx eslint .)
module.exports = [
  {
    files: ['**/*.js'],
    ignores: ['node_modules/**', 'coverage/**'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        require: 'readonly', module: 'writable', process: 'readonly', console: 'readonly',
        __dirname: 'readonly', Buffer: 'readonly', fetch: 'readonly', AbortSignal: 'readonly',
        setTimeout: 'readonly', setInterval: 'readonly',
      },
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['error', { args: 'none' }],
      'no-unreachable': 'error',
      'no-dupe-keys': 'error',
      'no-redeclare': 'error',
      'no-const-assign': 'error',
      'no-self-compare': 'error',
      'no-use-before-define': ['error', { functions: false }],
      eqeqeq: 'error',
      'prefer-const': 'error',
      'no-var': 'error',
      'max-len': ['warn', { code: 120, ignoreStrings: true, ignoreTemplateLiterals: true }],
    },
  },
];
