import { readFile, readdir } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MATERIALS } from '../src/materials.js';

const forbidden = [
  /Infra-Bridge\.ifc/,
  /infra-bridge-prototype/i,
  /referenceGlobalId/,
  /expressId/i,
  /GlobalId/,
  /@brepjs\/infra-bridge-reference/,
  /referenceManifest/,
  /(?:vertices|triangles)\s*:\s*\[/,
  /(?:matrix|transformMatrix)\s*:\s*\[/i,
];
const sourceOnlyForbidden = [/reference\/infra-bridge/];

describe('authored-source cleanliness', () => {
  it('contains no donor identity, geometry, path, inventory, or harness dependency', async () => {
    const projectRoot = new URL('../', import.meta.url);
    const sourceRoot = new URL('../src/', import.meta.url);
    const files = [
      ...(await sourceFiles(sourceRoot.pathname)),
      new URL('../package.json', import.meta.url).pathname,
      new URL('../tsconfig.json', import.meta.url).pathname,
      new URL('../tsconfig.typecheck.json', import.meta.url).pathname,
    ];
    const violations: string[] = [];
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      for (const pattern of forbidden) {
        if (pattern.test(source)) {
          violations.push(`${relative(projectRoot.pathname, file)}: ${pattern}`);
        }
      }
      if (file.startsWith(sourceRoot.pathname)) {
        for (const pattern of sourceOnlyForbidden) {
          if (pattern.test(source)) {
            violations.push(`${relative(projectRoot.pathname, file)}: ${pattern}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('keeps every material catalog entry attached to authored source', async () => {
    const sourceRoot = new URL('../src/', import.meta.url);
    const materialsPath = new URL('../src/materials.ts', import.meta.url).pathname;
    const authoredSource = (
      await Promise.all(
        (await sourceFiles(sourceRoot.pathname))
          .filter((path) => path !== materialsPath)
          .map((path) => readFile(path, 'utf8'))
      )
    ).join('\n');

    const unusedMaterials = Object.keys(MATERIALS).filter(
      (name) => !authoredSource.includes(`MATERIALS.${name}`)
    );
    expect(unusedMaterials).toEqual([]);
  });
});

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
    else if (['.ts', '.tsx'].includes(extname(entry.name))) files.push(path);
  }
  return files;
}
