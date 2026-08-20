/**
 * create-brepjs — scaffolds a working project skeleton: template files land
 * with the right names (npm-mangled ones renamed), the package takes the
 * project name, and non-empty targets are refused. Pure node; no kernel.
 */

import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const BIN = join(
  dirname(fileURLToPath(import.meta.url)),
  '../packages/create-brepjs/bin/create-brepjs.mjs'
);

let cwd = '';

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'create-brepjs-'));
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

function run(...args: string[]): { status: number | null; out: string } {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

describe('create-brepjs', () => {
  it('keeps the no-template command entry point available', async () => {
    const r = run('my-model');
    expect(r.status).toBe(0);
    const root = join(cwd, 'my-model');
    expect(await readdir(root)).not.toHaveLength(0);
    expect(r.out).toContain('Scaffolded ');
    expect(r.out).toContain('/my-model');
    expect(r.out).toContain('npx brepjs add');
  });

  it('accepts an existing empty target directory', async () => {
    const root = join(cwd, 'empty-target');
    await mkdir(root);

    const r = run('empty-target');

    expect(r.status).toBe(0);
    expect(await readdir(root)).not.toHaveLength(0);
  });

  it('refuses a non-empty target directory', async () => {
    await mkdir(join(cwd, 'taken'));
    await writeFile(join(cwd, 'taken/existing.txt'), 'x');
    const r = run('taken');
    expect(r.status).toBe(1);
    expect(r.out).toContain('not empty');
  });

  it('rejects hostile project names', () => {
    for (const name of [
      '--oops',
      '../escape',
      'a/../../b',
      '/абс',
      '/abs',
      'name/',
      '@scope/pkg',
    ]) {
      const r = run(name);
      expect(r.status, name).toBe(1);
      expect(r.out, name).toContain('invalid project name');
    }
  });

  it('accepts a nested relative path and names the package by its basename', async () => {
    const r = run('models/tiny-house');
    expect(r.status).toBe(0);
    const pkg = JSON.parse(await readFile(join(cwd, 'models/tiny-house/package.json'), 'utf8')) as {
      name: string;
    };
    expect(pkg.name).toBe('tiny-house');
  });

  it('records the fixed bim/bridge/v1 migration evidence', async () => {
    const baselinePath = join(
      dirname(fileURLToPath(import.meta.url)),
      'fixtures/create-brepjs/bim-bridge-v1-baseline.json'
    );
    const baseline = JSON.parse(await readFile(baselinePath, 'utf8')) as {
      compatibility: { preContractOutput: string };
      fixedRequest: {
        contract: string;
        project: { id: string };
      };
      expectedInventory: Record<string, number>;
      expectedCanonicalManifest: string[];
      referenceIfc: { sha256: string };
      sourceSnapshots: Array<{ root: string; fileCount: number; sha256: string }>;
    };

    expect(baseline.compatibility.preContractOutput).toBe('not-promised');
    expect(baseline.fixedRequest).toMatchObject({
      contract: 'bim/bridge/v1',
      project: { id: '7d8d1b9d-89e8-4df2-b4f9-76f1e910ad98' },
    });
    expect(baseline.expectedInventory).toEqual({
      sites: 6,
      facilities: 3,
      spatialParts: 18,
      products: 47,
      families: 13,
      spatialAssemblyDefinitions: 15,
      materials: 6,
    });
    expect(baseline.expectedCanonicalManifest).toContain('brepjs.config.ts');
    expect(baseline.expectedCanonicalManifest).toContain('assets/fonts/infra-bridge-block.otf');
    expect(baseline.expectedCanonicalManifest).toHaveLength(71);
    expect(baseline.expectedCanonicalManifest).toEqual(
      [...new Set(baseline.expectedCanonicalManifest)].sort()
    );
    expect(baseline.expectedCanonicalManifest).not.toContain('package-lock.json');
    expect(baseline.expectedCanonicalManifest).not.toContain('reference:compare');
    expect(baseline.referenceIfc.sha256).toBe(
      '241e6576a3a554086d3d2ae87415c5ba98a0123d329245810e7d42ecc504c183'
    );
    expect(baseline.sourceSnapshots).toEqual([
      {
        root: 'packages/create-brepjs',
        fileCount: 8,
        sha256: '7172ffed9df32a6b1fd7625cabd5e2487b74e2dc29755b2f9f75cad742d46628',
      },
      {
        root: 'examples/infra-bridge',
        fileCount: 51,
        sha256: 'bab7afa6776f6f43d2e74b3da1eea3679ee7d1f87a78274838af2959cc0edd38',
      },
      {
        root: 'reference/infra-bridge',
        fileCount: 86,
        sha256: 'dbce55494945a2b56e5d75389c874adb32cf5324fd538d01780f3a9a2df1c7a6',
      },
    ]);
  });
});
