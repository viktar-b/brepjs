import { readFile, readdir } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

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
    }
    expect(violations).toEqual([]);
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
