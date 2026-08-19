import rootConfig from '../../eslint.config.js';

export default [
  ...rootConfig,
  {
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.typecheck.json',
        projectService: false,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
];
