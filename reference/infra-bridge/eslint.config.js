import rootConfig from '../../eslint.config.js';

const workbenchFiles = [
  'workbench/src/**/*.{ts,tsx}',
  'workbench/shared/**/*.ts',
  'workbench/server/**/*.ts',
  'workbench/scripts/**/*.ts',
  'workbench/tests/**/*.ts',
  'workbench/vite.config.ts',
  'workbench/vitest.config.ts',
];

const rootSharedRules = rootConfig.find((config) => config.files?.includes('src/**/*.ts'))?.rules;
if (rootSharedRules === undefined) {
  throw new Error('Root ESLint shared TypeScript rules were not found');
}

export default [
  ...rootConfig,
  {
    files: workbenchFiles,
    rules: rootSharedRules,
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        projectService: false,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['tests/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.test.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['node/**/*.ts', 'scripts/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.compare.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: rootSharedRules,
  },
  {
    files: ['workbench/src/**/*.{ts,tsx}', 'workbench/shared/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: './workbench/tsconfig.json',
        projectService: false,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['workbench/server/**/*.ts', 'workbench/scripts/**/*.ts', 'workbench/vite.config.ts'],
    languageOptions: {
      parserOptions: {
        project: './workbench/tsconfig.server.json',
        projectService: false,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['workbench/tests/**/*.ts', 'workbench/vitest.config.ts'],
    languageOptions: {
      parserOptions: {
        project: './workbench/tsconfig.test.json',
        projectService: false,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  { ignores: ['workbench/dist/**'] },
];
