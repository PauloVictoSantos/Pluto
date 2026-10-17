import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/out/**',
      '**/coverage/**',
      'apps/web/ios/**',
      'apps/web/android/**',
      '**/next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // Proibido $where (secao 6.1 - injecao NoSQL)
      'no-restricted-syntax': [
        'error',
        { selector: "Property[key.value='$where']", message: '$where e proibido.' },
        { selector: "Property[key.name='$where']", message: '$where e proibido.' },
      ],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    files: ['infra/**/*.js'],
    languageOptions: { globals: { db: 'readonly', process: 'readonly' } },
  },
);
