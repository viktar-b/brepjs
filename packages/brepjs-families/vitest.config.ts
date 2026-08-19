import { resolve } from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      {
        find: 'brepjs-families/jsx-dev-runtime',
        replacement: resolve(import.meta.dirname, './src/jsxRuntime.ts'),
      },
      {
        find: 'brepjs-families/jsx-runtime',
        replacement: resolve(import.meta.dirname, './src/jsxRuntime.ts'),
      },
      {
        find: 'brepjs-families',
        replacement: resolve(import.meta.dirname, './src/index.ts'),
      },
      { find: '@', replacement: resolve(import.meta.dirname, '../../src') },
      { find: 'brepjs', replacement: resolve(import.meta.dirname, '../../src/index.ts') },
    ],
  },
  test: {
    globals: true,
    testTimeout: 90000,
    pool: 'forks',
    execArgv: ['--max-old-space-size=6144'],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
  },
});
