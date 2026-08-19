/** @jsxImportSource brepjs-families */

import { beforeAll, describe, expect, it } from 'vitest';
import { csg, getBounds } from 'brepjs';
import { evaluateModel, resolve, type ResolvedElement } from 'brepjs-families';
import { AbutmentSupportBeam } from '../src/families/abutmentSupportBeam.js';
import { ApproachSlab } from '../src/families/approachSlab.js';
import { RoadRailing } from '../src/families/roadRailing.js';
import { MATERIALS } from '../src/materials.js';

beforeAll(async () => {
  await import('brepjs/quick');
}, 30_000);

describe('completed road-bridge Families', () => {
  it('authors the pitched ApproachSlab around its upper inner Datum', () => {
    const resolved = resolve(
      <ApproachSlab
        key="slab"
        length={2_435.296}
        width={3_600}
        thickness={200}
        longitudinalSide="negative"
        transverseSide="negative"
        material={MATERIALS.prefabricatedConcrete}
      />
    );
    expect(resolved.semantics).toMatchObject({
      kind: 'slab',
      role: 'deck',
      material: MATERIALS.prefabricatedConcrete,
      properties: { length: 2_435.296, width: 3_600, height: 200, datum: 'upper-inner-corner' },
    });
    expectBounds(resolved, [-2_435.296, 0, -3_600, 0, -200, 0]);
  });

  it('authors the five-point AbutmentSupportBeam section in engineering axes', () => {
    const resolved = resolve(
      <AbutmentSupportBeam
        key="beam"
        length={3_600}
        width={195}
        bearingInset={20}
        bearingSeatHeight={556.993}
        backHeight={539.493}
        transverseSide="negative"
        material={MATERIALS.reinforcedConcrete}
      />
    );
    expect(resolved.semantics).toMatchObject({
      kind: 'beam',
      material: MATERIALS.reinforcedConcrete,
      properties: { length: 3_600, width: 195, height: 556.993 },
    });
    expectBounds(resolved, [0, 3_600, -195, 0, 0, 556.993]);
  });

  it('authors a reusable repeated-post RoadRailing with a deck-edge Datum', () => {
    const resolved = resolve(
      <RoadRailing
        key="railing"
        length={9_909}
        setoutInset={9}
        longitudinalSide="negative"
        railWidth={96}
        railHeight={196}
        lowerRailBase={-56}
        upperRailBase={404}
        postPitch={900}
        postThickness={96}
        postRunIn={847.5}
        postRunOut={114}
        material={MATERIALS.bridgeTimber}
      />
    );
    expect(resolved.semantics).toMatchObject({
      kind: 'railing',
      role: 'guardrail',
      material: MATERIALS.bridgeTimber,
      properties: { length: 9_909, width: 290.055, height: 956 },
    });
    expectBounds(resolved, [-9_900, 9, 0, 290.055, -336, 620]);
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
