/** @jsxImportSource brepjs-families */

import { beforeAll, describe, expect, it } from 'vitest';
import { csg, getBounds } from 'brepjs';
import { evaluateModel, resolve, type ResolvedElement } from 'brepjs-families';
import { ArchSegment } from '../src/families/archSegment.js';
import { BridgeNameSign, PROJECT_SIGN_FONT } from '../src/families/bridgeNameSign.js';
import { EarthFill } from '../src/families/earthFill.js';
import { RailPierStem } from '../src/families/railPierStem.js';
import { SpandrelWall } from '../src/families/spandrelWall.js';
import { MATERIALS } from '../src/materials.js';
import { loadProjectFont } from '../src/fonts/projectFont.js';

beforeAll(async () => {
  await import('brepjs/quick');
  await loadProjectFont();
}, 30_000);

describe('rail-arch bridge Families', () => {
  it('authors the cubic-crown EarthFill in physical millimetres', () => {
    const resolved = resolve(
      <EarthFill
        key="fill"
        halfSpan={5_000}
        halfWidth={1_750}
        crownRise={4_084.236}
        material={MATERIALS.genericSoil}
      />
    );
    expect(resolved.semantics).toMatchObject({
      kind: 'earthworks-fill',
      material: MATERIALS.genericSoil,
      properties: { length: 10_000, width: 3_500, height: 4_084.236, profile: 'cubic-crown' },
    });
    expectBounds(resolved, [-5_000, 5_000, -1_750, 1_750, 0, 4_084.236]);
  });

  it('authors one reusable curved ArchSegment with named outer and inner controls', () => {
    const resolved = resolve(
      <ArchSegment
        key="arch"
        outerRun={5_000}
        outerRise={4_084.236}
        innerRun={4_250}
        innerRise={3_333.333}
        bandThickness={750}
        halfWidth={1_750}
        material={MATERIALS.graniteMasonry}
      />
    );
    expect(resolved.semantics).toMatchObject({
      kind: 'member',
      role: 'arch-segment',
      material: MATERIALS.graniteMasonry,
      properties: { length: 5_000, width: 3_500, height: 4_084.236 },
    });
    expectBounds(resolved, [-750, 4_250, -1_750, 1_750, 0, 4_084.236]);
  });

  it('authors the regular two-bay SpandrelWall as a closed cut solid', () => {
    const resolved = resolve(
      <SpandrelWall
        key="wall"
        length={20_000}
        thickness={450}
        height={4_484.236}
        bayCount={2}
        openingRun={4_250}
        openingRise={3_333.333}
        material={MATERIALS.graniteMasonry}
      />
    );
    expect(resolved.semantics).toMatchObject({
      kind: 'wall',
      material: MATERIALS.graniteMasonry,
      properties: { length: 20_000, width: 450, height: 4_484.236 },
    });
    expectBounds(resolved, [0, 20_000, 0, 450, 0, 4_484.236]);
  });

  it('authors the masonry RailPierStem from its lower Datum', () => {
    const resolved = resolve(
      <RailPierStem
        key="stem"
        longitudinalWidth={1_500}
        transverseLength={4_400}
        height={3_780.346}
        material={MATERIALS.graniteMasonry}
      />
    );
    expect(resolved.semantics).toMatchObject({
      kind: 'column',
      role: 'pier-stem',
      material: MATERIALS.graniteMasonry,
      properties: { length: 1_500, width: 4_400, height: 3_780.346 },
    });
    expectBounds(resolved, [-750, 750, 0, 4_400, 0, 3_780.346]);
  });

  it('authors a backed BridgeNameSign with declared visible block lettering', () => {
    const resolved = resolve(
      <BridgeNameSign
        key="sign"
        text="BREPJS"
        width={1_600}
        height={400}
        plateDepth={30}
        reliefDepth={20}
        material={MATERIALS.copper}
      />
    );
    expect(resolved.semantics).toMatchObject({
      kind: 'sign',
      material: MATERIALS.copper,
      properties: {
        length: 1_600,
        width: 50,
        height: 400,
        text: 'BREPJS',
        font: PROJECT_SIGN_FONT.family,
      },
    });
    expect(resolved.geometry.kind).toBe('Compound');
    if (resolved.geometry.kind === 'Compound') {
      const lettering = resolved.geometry.children[1];
      expect(lettering?.kind).toBe('Translate');
      if (lettering?.kind === 'Translate' && lettering.target.kind === 'Rotate') {
        const relief = lettering.target.target;
        expect(relief.kind).toBe('Compound');
        if (relief.kind === 'Compound') {
          expect(relief.children.length).toBeGreaterThan(0);
          expect(
            relief.children.every(
              (node) => node.kind === 'Extrude' && node.profile.kind === 'Profile'
            )
          ).toBe(true);
        }
      }
    }
    expectBounds(resolved, [-800, 800, -50, 0, 0, 400]);
  });

  it('rejects sign text that the declared block font cannot render or fit', () => {
    expect(() => (
      <BridgeNameSign
        key="unsupported"
        text="BRIDGE"
        width={1_600}
        height={400}
        plateDepth={30}
        reliefDepth={20}
        material={MATERIALS.copper}
      />
    )).toThrow(/invalid props for family 'BridgeNameSign'/);
    expect(() => (
      <BridgeNameSign
        key="overflow"
        text="BREPJS"
        width={1_000}
        height={400}
        plateDepth={30}
        reliefDepth={20}
        material={MATERIALS.copper}
      />
    )).toThrow(/invalid props for family 'BridgeNameSign'/);
  });
});

function expectBounds(resolved: ResolvedElement, expected: readonly number[]): void {
  using evaluator = new csg.Evaluator();
  const evaluated = evaluateModel(resolved, evaluator, {}, { shapes: true });
  const shape = evaluated.byKeyPath.get(resolved.keyPath)?.shape;
  expect(shape?.ok).toBe(true);
  if (shape === undefined || !shape.ok) return;
  const bounds = getBounds(shape.value);
  const actual = [bounds.xMin, bounds.xMax, bounds.yMin, bounds.yMax, bounds.zMin, bounds.zMax];
  expected.forEach((value, index) => {
    expect(actual[index]).toBeCloseTo(value, 3);
  });
}
