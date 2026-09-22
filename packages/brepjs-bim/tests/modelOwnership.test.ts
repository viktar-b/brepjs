import { bodySolids } from '../src/types/productBody.js';
import { beforeAll, expect, it } from 'vitest';
import { clone, getKernel, measureVolume, unwrap } from 'brepjs';
import { BimModel } from '../src/model/bimModel.js';
import type { WallSpec } from '../src/specs/wallSpec.js';
import { nativeShapeCount } from './helpers/nativeArena.js';
import { currentKernel, initKernel } from '../../../tests/setup.js';

beforeAll(async () => {
  await initKernel();
}, 30000);

const WALL: WallSpec = {
  length: 2,
  height: 3,
  thickness: 1,
  origin: [0, 0, 0],
  axisX: [1, 0, 0],
  axisZ: [0, 0, 1],
  materialName: 'Brick',
};

it('owns a protected recipe Body and releases it when its model closes', () => {
  const baseline = currentKernel === 'occt-wasm' ? nativeShapeCount() : null;
  {
    using model = new BimModel();
    unwrap(model.init({ name: 'Ownership test' }));
    const id = unwrap(model.addWall(WALL));
    const wall = model.getElement(id);
    if (wall?.category !== 'WALL') throw new Error('Expected retained Wall');
    expect(wall.geometry.kind).toBe('PARAMETRIC');
    expect(bodySolids(wall.geometry)).toHaveLength(1);
    expect(Object.isFrozen(wall)).toBe(true);
    expect(Object.isFrozen(wall.geometry)).toBe(true);
    expect(Object.isFrozen(bodySolids(wall.geometry))).toBe(true);
    expect(unwrap(measureVolume(bodySolids(wall.geometry)[0]))).toBeCloseTo(6, 8);
    const [listed] = model.getWalls();
    if (!listed) throw new Error('Missing listed Wall');
    expect(bodySolids(listed.geometry)[0]).toBe(bodySolids(wall.geometry)[0]);
  }
  if (baseline !== null) expect(nativeShapeCount()).toBe(baseline);
});

it('rejects borrowed Body handles in either adoption direction without consuming a stable key', () => {
  using model = new BimModel();
  const id = unwrap(model.addWall(WALL));
  const wall = model.getElement(id);
  if (wall?.category !== 'WALL') throw new Error('Expected Wall');
  const borrowed = bodySolids(wall.geometry)[0];
  expect(
    model.addProxy({ name: 'Borrowed', solid: borrowed }, { stableKey: 'retry' })
  ).toMatchObject({ ok: false, error: { code: 'BODY_OWNERSHIP_CONFLICT' } });
  expect(model.takeExactProductBody(id, { kind: 'EXACT', solids: [borrowed] })).toMatchObject({
    ok: false,
    error: { code: 'BODY_OWNERSHIP_CONFLICT' },
  });
  const independent = unwrap(clone(borrowed));
  const proxy = unwrap(
    model.addProxy({ name: 'Independent', solid: independent }, { stableKey: 'retry' })
  );
  expect(model.takeExactProductBody(id, { kind: 'EXACT', solids: [independent] })).toMatchObject({
    ok: false,
    error: { code: 'BODY_OWNERSHIP_CONFLICT' },
  });
  expect(model.getElement(proxy)?.geometry).toBe(independent);
  expect(borrowed.disposed).toBe(false);
  expect(independent.disposed).toBe(false);
});

it.each(['PANEL', 'POSTED'] as const)(
  'adopts real %s railing recipe output as native solid items',
  (infill) => {
    const baseline = currentKernel === 'occt-wasm' ? nativeShapeCount() : null;
    {
      using model = new BimModel();
      const created = model.addRailing({
        ...WALL,
        length: 2000,
        height: 1000,
        thickness: 50,
        infill,
      });
      const id = unwrap(created);
      const railing = model.getElement(id);
      if (railing?.category !== 'RAILING') throw new Error('Expected Railing');
      expect(railing.geometry.kind).toBe('PARAMETRIC');
      expect(bodySolids(railing.geometry).length).toBeGreaterThan(0);
      for (const item of bodySolids(railing.geometry))
        expect(getKernel().shapeType(item.wrapped)).toBe('solid');
    }
    if (baseline !== null) expect(nativeShapeCount()).toBe(baseline);
  }
);
