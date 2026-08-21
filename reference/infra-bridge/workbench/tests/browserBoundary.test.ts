import { access, readFile, readdir } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  auditBrowserAssets,
  findForbiddenBrowserModules,
} from '../scripts/browserBuildBoundary.js';

const workbenchRoot = new URL('../', import.meta.url);

describe('nested workbench browser boundary', () => {
  it('is owned by the Reference workspace instead of declaring another package', async () => {
    await expect(access(new URL('package.json', workbenchRoot))).rejects.toThrow();
  });

  it('prepares every ignored workspace build consumed by the workbench and fresh batch child', async () => {
    const ownerPackage = await readFile(new URL('../../package.json', import.meta.url), 'utf8');
    expect(ownerPackage).toContain(
      '"workbench:prepare": "npm -C ../.. run build && npm -C ../../packages/brepjs-families run build && npm -C ../../packages/brepjs-bim run build && npm -C ../../packages/brepjs-viewer run build && npm run build"'
    );
  });

  it('has a mountable React application shell', async () => {
    await expect(readFile(new URL('index.html', workbenchRoot), 'utf8')).resolves.toContain(
      'id="root"'
    );
    await expect(readFile(new URL('src/main.tsx', workbenchRoot), 'utf8')).resolves.toContain(
      'createRoot'
    );
  });

  it('keeps Node, IFC, CAD evaluation, authored source, and server imports out of browser files', async () => {
    const files = await sourceFiles(new URL('src/', workbenchRoot));
    const forbidden = [
      /from ['"]node:/,
      /from ['"]web-ifc/,
      /from ['"]occt-wasm/,
      /from ['"]brepjs['"/]/,
      /from ['"]brepjs-bim/,
      /from ['"]brepjs-families/,
      /from ['"](?:shiki|@shikijs)/,
      /examples\/infra-bridge/,
      /\.\.\/server\//,
      /\.\.\/\.\.\/src\//,
    ];
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      expect(
        forbidden.filter((pattern) => pattern.test(source)),
        file.pathname
      ).toEqual([]);
    }
  });

  it('rejects forbidden package roots after aliases and transitive imports resolve', () => {
    const repositoryRoot = '/repo';
    const findings = findForbiddenBrowserModules(
      [
        '/repo/reference/infra-bridge/workbench/src/main.tsx',
        '/repo/node_modules/.pnpm/web-ifc@0.0.77/node_modules/web-ifc/web-ifc-api.js',
        '/repo/packages/brepjs-bim/dist/index.js',
        '/repo/node_modules/shiki/dist/index.mjs',
        '/repo/examples/infra-bridge/src/Model.tsx?import',
        '/repo/reference/infra-bridge/workbench/src/decoder.ts?worker',
      ],
      repositoryRoot
    );
    expect(findings.map(({ moduleId }) => moduleId)).toEqual([
      '/repo/node_modules/.pnpm/web-ifc@0.0.77/node_modules/web-ifc/web-ifc-api.js',
      '/repo/packages/brepjs-bim/dist/index.js',
      '/repo/node_modules/shiki/dist/index.mjs',
      '/repo/examples/infra-bridge/src/Model.tsx?import',
      '/repo/reference/infra-bridge/workbench/src/decoder.ts?worker',
    ]);
  });

  it('rejects emitted WebAssembly and worker assets', () => {
    expect(() => {
      auditBrowserAssets([
        { fileName: 'assets/index-a1.js', type: 'chunk', facadeModuleId: '/app/main.tsx' },
        { fileName: 'assets/geometry-a2.wasm', type: 'asset' },
      ]);
    }).toThrow(/WebAssembly/u);

    expect(() => {
      auditBrowserAssets([
        {
          fileName: 'assets/decoder-a3.js',
          type: 'chunk',
          facadeModuleId: '/app/decoder.ts?worker',
        },
      ]);
    }).toThrow(/worker/u);

    expect(() => {
      auditBrowserAssets([
        {
          fileName: 'assets/index-a4.js',
          type: 'chunk',
          source: 'const decoder = new Worker(new URL("decoder-a3.js", import.meta.url));',
        },
      ]);
    }).toThrow(/worker/u);
  });
});

async function sourceFiles(directory: URL): Promise<URL[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const url = new URL(entry.name, directory);
      if (entry.isDirectory()) return sourceFiles(new URL(`${entry.name}/`, directory));
      return /\.(?:ts|tsx)$/.test(entry.name) ? [url] : [];
    })
  );
  return nested.flat();
}
