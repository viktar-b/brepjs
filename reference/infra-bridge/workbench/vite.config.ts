import react from '@vitejs/plugin-react';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type UserConfig } from 'vite';
import { browserBuildBoundaryPlugin } from './scripts/browserBuildBoundary.js';

const workbenchRoot = fileURLToPath(new URL('.', import.meta.url));
const repositoryRoot = resolve(workbenchRoot, '../../..');
const packageRequire = createRequire(import.meta.url);

export function createWorkbenchViteConfig(): UserConfig {
  return {
    root: workbenchRoot,
    base: './',
    publicDir: false,
    cacheDir: resolve(workbenchRoot, '../node_modules/.vite/workbench'),
    plugins: [react(), browserBuildBoundaryPlugin(repositoryRoot)],
    oxc: {
      target: 'es2022',
    },
    resolve: {
      alias: {
        react: dirname(packageRequire.resolve('react/package.json')),
        'react-dom': dirname(packageRequire.resolve('react-dom/package.json')),
        '@react-three/fiber': dirname(packageRequire.resolve('@react-three/fiber/package.json')),
      },
      dedupe: ['react', 'react-dom', '@react-three/fiber', '@react-three/drei', 'three'],
    },
    build: {
      outDir: resolve(workbenchRoot, 'dist'),
      emptyOutDir: true,
      chunkSizeWarningLimit: 1_100,
    },
  };
}

export default defineConfig(createWorkbenchViteConfig());
