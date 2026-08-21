import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

const sharedRules = {
  '@typescript-eslint/no-deprecated': 'warn',
  '@typescript-eslint/no-explicit-any': 'error',
  '@typescript-eslint/no-non-null-assertion': 'error',
  '@typescript-eslint/consistent-type-imports': 'error',
  '@typescript-eslint/no-unused-vars': [
    'error',
    { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
  ],
  '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
  '@typescript-eslint/no-unnecessary-condition': 'error',
  '@typescript-eslint/no-unsafe-assignment': 'off',
  '@typescript-eslint/no-unsafe-member-access': 'off',
  '@typescript-eslint/no-unsafe-call': 'off',
  '@typescript-eslint/no-unsafe-return': 'off',
  '@typescript-eslint/no-unsafe-argument': 'off',
  '@typescript-eslint/no-this-alias': 'error',
  '@typescript-eslint/prefer-readonly': 'error',
  '@typescript-eslint/switch-exhaustiveness-check': [
    'error',
    { considerDefaultExhaustiveForUnions: true },
  ],
  '@typescript-eslint/ban-ts-comment': [
    'error',
    {
      'ts-expect-error': { descriptionFormat: '-- .+' },
      'ts-ignore': true,
      'ts-nocheck': true,
    },
  ],
  'prefer-const': 'error',
  eqeqeq: 'error',
  'no-var': 'error',
  'no-console': ['error', { allow: ['error', 'warn'] }],
};
const typedFiles = ['src/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}'];

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked.map((config) => ({ ...config, files: typedFiles })),
  {
    files: typedFiles,
    languageOptions: {
      parserOptions: {
        project: './tsconfig.typecheck.json',
        projectService: false,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: sharedRules,
  },
  {
    files: ['scripts-tbd-upstream/**/*.mjs'],
    languageOptions: {
      globals: { console: 'readonly', fetch: 'readonly', process: 'readonly' },
    },
  },
  {
    ignores: ['.cache/', 'dist/', 'lib/', 'node_modules/', 'vendor/'],
  }
);
