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

const EXPECTED_BRIDGE_MANIFEST = [
  '.gitignore',
  'AGENTS.md',
  'README.md',
  'THIRD_PARTY_NOTICES.md',
  'assets/fonts/infra-bridge-block.otf',
  'brepjs.config.ts',
  'docs/coordinates.md',
  'docs/model-structure.md',
  'docs/provenance.md',
  'docs/validation.md',
  'eslint.config.js',
  'package.json',
  'requirements/bim-bridge-v1.ids',
  'requirements/project.ids',
  'src/assemblies/bridge-parts/RailArchSuperstructure.tsx',
  'src/assemblies/bridge-parts/RailPier.tsx',
  'src/assemblies/bridge-parts/RailSubstructure.tsx',
  'src/assemblies/bridge-parts/RoadAbutment.tsx',
  'src/assemblies/bridge-parts/RoadApproach.tsx',
  'src/assemblies/bridge-parts/RoadDeck.tsx',
  'src/assemblies/bridge-parts/RoadPier.tsx',
  'src/assemblies/bridge-parts/RoadSubstructure.tsx',
  'src/assemblies/bridge-parts/RoadSuperstructure.tsx',
  'src/assemblies/bridges/RailArchBridge.tsx',
  'src/assemblies/bridges/RoadGirderBridge.tsx',
  'src/assemblies/sites/ContextSite.tsx',
  'src/assemblies/sites/EnvironmentSite.tsx',
  'src/assemblies/sites/RailBridgeSite.tsx',
  'src/assemblies/sites/RoadBridgeSite.tsx',
  'src/families/deck/ApproachSlab.tsx',
  'src/families/deck/BridgeDeck.tsx',
  'src/families/deck/RoadRailing.tsx',
  'src/families/earthworks/EarthFill.tsx',
  'src/families/signage/BridgeNameSign.tsx',
  'src/families/signage/projectFont.ts',
  'src/families/substructure/AbutmentSupportBeam.tsx',
  'src/families/substructure/CrossGirder.tsx',
  'src/families/substructure/Footing.tsx',
  'src/families/substructure/PierStem.tsx',
  'src/families/substructure/RailPierStem.tsx',
  'src/families/superstructure/ArchSegment.tsx',
  'src/families/superstructure/MainGirder.tsx',
  'src/families/superstructure/SpandrelWall.tsx',
  'src/materials/materials.ts',
  'src/model/InfraBridge.tsx',
  'src/model/buildModel.ts',
  'src/preview/generatePreview.ts',
  'src/preview/renderSnapshot.ts',
  'src/projection/exportIfc.ts',
  'src/projection/projectModel.ts',
  'src/setout/frameFromSetOut.ts',
  'src/setout/railBridgeSetouts.ts',
  'src/setout/roadBridgeSetouts.ts',
  'src/setout/siteSetouts.ts',
  'src/validation/report.ts',
  'src/validation/validateProject.ts',
  'tests/families/deck.test.tsx',
  'tests/families/earthworks.test.tsx',
  'tests/families/signage.test.tsx',
  'tests/families/substructure.test.tsx',
  'tests/families/superstructure.test.tsx',
  'tests/preview.test.ts',
  'tests/projection/ifcProjection.test.tsx',
  'tests/projection/ifcRoundTrip.test.tsx',
  'tests/spatial/assemblies.test.tsx',
  'tests/spatial/modelHierarchy.test.tsx',
  'tests/spatial/setout.test.ts',
  'tests/validation/cleanliness.test.ts',
  'tests/validation/validationReport.test.ts',
  'tsconfig.json',
  'vitest.config.ts',
] as const;

describe('create-brepjs', () => {
  it('keeps the no-template command entry point available', async () => {
    const r = run('my-model');
    expect(r.status).toBe(0);
    const root = join(cwd, 'my-model');
    expect(await readdir(root)).not.toHaveLength(0);
    expect(r.out).toContain('Scaffolded ');
    expect(r.out).toContain('/my-model');
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
      fixedRequest: unknown;
      expectedInventory: Record<string, number>;
      expectedCanonicalManifest: string[];
      referenceIfc: { sha256: string };
      sourceSnapshots: Array<{ root: string; fileCount: number; sha256: string }>;
    };

    expect(baseline.compatibility.preContractOutput).toBe('not-promised');
    expect(baseline.fixedRequest).toEqual({
      contract: 'bim/bridge/v1',
      targetDir: {
        rule: 'caller-supplied absolute temporary directory',
        basename: 'infra-bridge',
      },
      project: {
        id: '7d8d1b9d-89e8-4df2-b4f9-76f1e910ad98',
        key: 'infra-bridge',
        name: 'Infra Bridge',
      },
      organization: { name: 'brepjs' },
      projection: {
        crs: 'EPSG:32760',
        verticalDatum: 'Local bridge datum',
        eastingMm: 729_011_225.8823584,
        northingMm: 9_063_960_607.644705,
        elevationMm: 0,
        xAxisBearingDeg: 90,
      },
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
    expect(baseline.expectedCanonicalManifest).toEqual(EXPECTED_BRIDGE_MANIFEST);
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
