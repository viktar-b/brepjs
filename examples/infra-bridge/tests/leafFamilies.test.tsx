/** @jsxImportSource brepjs-families */

import { beforeAll, describe, expect, it } from 'vitest';
import { csg, getBounds, type Bounds3D } from 'brepjs';
import { evaluateModel, resolve, type ResolvedElement } from 'brepjs-families';
import { BridgeDeck } from '../src/families/bridgeDeck.js';
import { CrossGirder } from '../src/families/crossGirder.js';
import { MainGirder } from '../src/families/mainGirder.js';
import { PierStem } from '../src/families/pierStem.js';

beforeAll(async () => {
  await import('brepjs/quick');
}, 30_000);

describe('Gate 3 engineering-coordinate Families', () => {
  it('authors BridgeDeck with longitudinal X, transverse Y, upward Z, and a setout Datum', () => {
    const resolved = resolve(
      <BridgeDeck
        key="deck"
        length={9_909}
        width={3_368}
        thickness={56}
        setoutInset={9}
        material="wood-generic"
      />
    );
    expect(resolved.semantics).toMatchObject({
      kind: 'slab',
      role: 'deck',
      material: 'wood-generic',
      properties: { length: 9_909, width: 3_368, height: 56, datum: 'lower-setout-point' },
    });
    expectBounds(resolved, [-9, 9_900, -3_359, 9, 0, 56]);
  });

  it('authors MainGirder longitudinally along X from its end Datum', () => {
    const resolved = resolve(
      <MainGirder key="girder" length={9_891} width={250} depth={300} material="wood-generic" />
    );
    expect(resolved.semantics).toMatchObject({
      kind: 'beam',
      role: 'girder',
      properties: { length: 9_891, width: 250, height: 300, datum: 'lower-centreline-end' },
    });
    expectBounds(resolved, [-9_891, 0, -125, 125, 0, 300]);
  });

  it('authors CrossGirder along X with an explicit transverse side', () => {
    const resolved = resolve(
      <CrossGirder
        key="cross"
        length={4_000}
        width={300}
        depth={400}
        transverseSide="positive"
        material="wood-generic"
      />
    );
    expect(resolved.semantics).toMatchObject({
      kind: 'beam',
      role: 'cross-girder',
      properties: { length: 4_000, width: 300, height: 400, datum: 'lower-end-corner' },
    });
    expectBounds(resolved, [-4_000, 0, 0, 300, 0, 400]);
  });

  it('authors PierStem below its cap control Datum in engineering axes', () => {
    const resolved = resolve(
      <PierStem
        key="stem"
        length={3_600}
        width={550}
        height={2_286.321}
        capOffset={756}
        material="stone_granite_masonry"
      />
    );
    expect(resolved.semantics).toMatchObject({
      kind: 'column',
      role: 'pier-stem',
      properties: { length: 3_600, width: 550, datum: 'pier-cap-control-point' },
    });
    expectBounds(resolved, [-1_800, 1_800, -275, 275, -3_042.321, -756]);
  });
});

function expectBounds(resolved: ResolvedElement, expected: readonly number[]): void {
  using evaluator = new csg.Evaluator();
  const evaluated = evaluateModel(resolved, evaluator, {}, { shapes: true });
  const shape = evaluated.byKeyPath.get(resolved.keyPath)?.shape;
  expect(shape?.ok).toBe(true);
  if (shape === undefined || !shape.ok) return;
  const bounds: Bounds3D = getBounds(shape.value);
  const actual = [bounds.xMin, bounds.xMax, bounds.yMin, bounds.yMax, bounds.zMin, bounds.zMax];
  expected.forEach((value, index) => {
    expect(actual[index]).toBeCloseTo(value, 4);
  });
}
