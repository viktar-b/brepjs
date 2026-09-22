import { beforeAll, afterEach, expect, it, vi } from 'vitest';
import { box, unwrap, type ValidSolid } from 'brepjs';
import { BimModel } from '../src/model/bimModel.js';
import type { WallSpec } from '../src/specs/wallSpec.js';
import { currentKernel, initKernel } from '../../../tests/setup.js';
import { nativeShapeCount } from './helpers/nativeArena.js';

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
const arena = () => (currentKernel === 'occt-wasm' ? nativeShapeCount() : null);
function expectArena(count: number | null) {
  if (count !== null) expect(nativeShapeCount()).toBe(count);
}
afterEach(() => vi.restoreAllMocks());

it('attempts all model-owned releases before throwing an aggregate, and disposal twice never retries', () => {
  const baseline = arena();
  const model = new BimModel();
  const inputs: ValidSolid[] = [box(1, 1, 1), box(2, 2, 2), box(3, 3, 3)];
  const attempts = inputs.map((solid, index) => {
    unwrap(model.addProxy({ name: `Proxy ${index}`, solid }));
    const release = solid[Symbol.dispose].bind(solid);
    return vi.spyOn(solid, Symbol.dispose).mockImplementation(() => {
      release();
      if (index !== 1) throw new Error(`Release ${index}`);
    });
  });
  expect(() => model[Symbol.dispose]()).toThrow(AggregateError);
  expect(model.getGeometryCleanupDiagnostics()).toHaveLength(2);
  expect(() => model[Symbol.dispose]()).not.toThrow();
  for (const attempt of attempts) expect(attempt).toHaveBeenCalledTimes(1);
  const before = model.getAllElements();
  let reads = 0;
  expect(
    model.addWall({
      ...WALL,
      get length() {
        reads++;
        return 9;
      },
    })
  ).toMatchObject({ ok: false, error: { code: 'MODEL_DISPOSED' } });
  expect(model.init({ name: 'After close' })).toMatchObject({
    ok: false,
    error: { code: 'MODEL_DISPOSED' },
  });
  expect(model.addSite({ name: 'After close' })).toMatchObject({
    ok: false,
    error: { code: 'MODEL_DISPOSED' },
  });
  expect(reads).toBe(0);
  expect(model.getAllElements()).toEqual(before);
  expectArena(baseline);
});

it('keeps a successful LocalId outcome and diagnostics when retiring a slab opening host fails', () => {
  const baseline = arena();
  const model = new BimModel();
  const id = unwrap(model.addSlab({ ...WALL, length: 10, width: 10, predefinedType: 'FLOOR' }));
  const before = model.getElement(id);
  if (before?.category !== 'SLAB') throw new Error('Expected Slab');
  const release = before.geometry[Symbol.dispose].bind(before.geometry);
  let callbackRelationships: unknown;
  const cause = new Error('Old slab release');
  const attempt = vi.spyOn(before.geometry, Symbol.dispose).mockImplementation(() => {
    callbackRelationships = model.getAllRelationships();
    release();
    throw cause;
  });
  const opening = unwrap(
    model.addSlabOpening({ slabLocalId: id, sizeX: 1, sizeY: 1, offsetX: 1, offsetY: 1 })
  );
  expect(model.getElement(opening)?.category).toBe('OPENING');
  expect(callbackRelationships).toEqual(model.getAllRelationships());
  expect(model.getGeometryCleanupDiagnostics()).toMatchObject([
    { operation: 'addSlabOpening', localId: id, itemIndex: 0, cause },
  ]);
  const after = model.getElement(id);
  if (after?.category !== 'SLAB') throw new Error('Expected Slab');
  expect(after.geometry === before.geometry).toBe(false);
  expect(model.addProxy({ name: 'Borrowed slab', solid: after.geometry })).toMatchObject({
    ok: false,
    error: { code: 'BODY_OWNERSHIP_CONFLICT' },
  });
  model[Symbol.dispose]();
  model[Symbol.dispose]();
  expect(attempt).toHaveBeenCalledTimes(1);
  expectArena(baseline);
});
