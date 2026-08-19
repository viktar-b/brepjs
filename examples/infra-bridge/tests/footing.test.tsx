/** @jsxImportSource brepjs-families */

import { beforeAll, describe, expect, it } from 'vitest';
import { csg, getBounds } from 'brepjs';
import { evaluateModel, resolve } from 'brepjs-families';
import { Footing } from '../src/families/footing.js';
import { MATERIALS } from '../src/materials.js';

beforeAll(async () => {
  await import('brepjs/quick');
}, 30_000);

describe('Footing Family', () => {
  it('uses a top-centre Datum and retains definition-owned engineering semantics', () => {
    const resolved = resolve(
      <Footing
        key="footing"
        length={5_000}
        width={2_100}
        thickness={700}
        material={MATERIALS.reinforcedConcrete}
      />
    );
    expect(resolved).toMatchObject({
      definitionKind: 'Family',
      keyPath: 'footing',
      semantics: {
        kind: 'footing',
        role: 'pad',
        material: MATERIALS.reinforcedConcrete,
        properties: {
          length: 5_000,
          width: 2_100,
          height: 700,
          datum: 'top-centre',
        },
      },
    });

    using evaluator = new csg.Evaluator();
    const evaluated = evaluateModel(resolved, evaluator, {}, { shapes: true });
    const shape = evaluated.byKeyPath.get('footing')?.shape;
    expect(shape?.ok).toBe(true);
    if (shape === undefined || !shape.ok) return;
    const bounds = getBounds(shape.value);
    expect(bounds.xMin).toBeCloseTo(-2_500, 4);
    expect(bounds.xMax).toBeCloseTo(2_500, 4);
    expect(bounds.yMin).toBeCloseTo(-1_050, 4);
    expect(bounds.yMax).toBeCloseTo(1_050, 4);
    expect(bounds.zMin).toBeCloseTo(-700, 4);
    expect(bounds.zMax).toBeCloseTo(0, 4);
  });
});
