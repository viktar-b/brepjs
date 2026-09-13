import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  box,
  clone,
  getBounds,
  measureVolume,
  polygon,
  translate,
  unwrap,
  type ValidSolid,
} from 'brepjs';
import { initKernel } from '../../../tests/setup.js';
import {
  BimModel,
  bodySolids,
  disposeImportedModel,
  fromIfc,
  measureProductBodyVolume,
  toIfc,
  type LocalId,
  type ProductBody,
  type WallSpec,
} from '../src/index.js';

beforeAll(async () => {
  await initKernel();
}, 30_000);

const WALL: WallSpec = {
  length: 1_000,
  height: 500,
  thickness: 100,
  origin: [0, 0, 0],
  axisX: [1, 0, 0],
  axisZ: [0, 0, 1],
  materialName: 'Concrete',
  customProperties: { Pset_Project: { Mark: 'W-01' } },
};

function wallBody(model: BimModel, id: LocalId): ProductBody {
  const element = model.getElement(id);
  if (element?.category !== 'WALL') throw new Error('Expected wall');
  return element.geometry;
}

describe('ProductBody through the public model API', () => {
  it('rejects malformed JavaScript Body containers before ownership transfer', () => {
    using model = new BimModel();
    const id = unwrap(model.addWall(WALL));
    const original = wallBody(model, id);
    for (const malformed of [
      null,
      {},
      { kind: 'AUTHORITATIVE' },
      { kind: 'PARAMETRIC', items: null },
    ]) {
      // @ts-expect-error -- JavaScript callers can supply malformed Body containers.
      const result = model.takeProductBody(id, malformed);
      expect(result.ok).toBe(false);
      expect(wallBody(model, id)).toBe(original);
      expect(unwrap(measureVolume(original.items[0]))).toBeCloseTo(50_000_000, 4);
    }
  });

  it('adopts the item snapshot it validated without rereading a caller getter', () => {
    using model = new BimModel();
    const id = unwrap(model.addWall(WALL));
    const original = wallBody(model, id).items[0];
    const first = box(10, 10, 10);
    const second = box(20, 10, 10);
    const items: [ValidSolid, ...ValidSolid[]] = [first, second];
    const readSecond = vi.fn().mockReturnValueOnce(second).mockReturnValue(original);
    Object.defineProperty(items, '1', { get: readSecond });
    unwrap(model.takeProductBody(id, { kind: 'AUTHORITATIVE', items }));
    expect(readSecond).toHaveBeenCalledTimes(1);
    expect(wallBody(model, id).items).toEqual([first, second]);
    expect(unwrap(measureProductBodyVolume(wallBody(model, id)))).toBeCloseTo(2_000, 6);
  });

  it('protects adopted object and item order against mutable caller aliases', () => {
    using model = new BimModel();
    const id = unwrap(model.addWall(WALL));
    const first = box(100, 100, 100);
    const second = box(200, 100, 100);
    using unrelated = box(10, 10, 10);
    const items: [ValidSolid, ...ValidSolid[]] = [first, second];
    const input: { kind: ProductBody['kind']; items: typeof items } = {
      kind: 'PARAMETRIC',
      items,
    };
    unwrap(model.takeProductBody(id, input));

    items.reverse();
    items.push(unrelated);
    input.kind = 'AUTHORITATIVE';
    const stored = wallBody(model, id);
    expect(stored).not.toBe(input);
    expect(stored.kind).toBe('PARAMETRIC');
    expect(bodySolids(stored)).toEqual([first, second]);
    expect(Object.isFrozen(stored)).toBe(true);
    expect(Object.isFrozen(bodySolids(stored))).toBe(true);
    expect(Reflect.set(bodySolids(stored), '0', unrelated)).toBe(false);
    expect(Reflect.set(stored, 'kind', 'AUTHORITATIVE')).toBe(false);
  });

  it('rejects other model-owned Body, singleton, and curtain component handles', () => {
    using model = new BimModel();
    const target = unwrap(model.addWall(WALL));
    const other = unwrap(model.addWall(WALL));
    const slabId = unwrap(model.addSlab({ ...WALL, width: 500, predefinedType: 'FLOOR' }));
    const curtainId = unwrap(
      model.addCurtainWall({
        ...WALL,
        width: 1_000,
        columns: 1,
        rows: 1,
        panelThickness: 10,
        mullionWidth: 20,
        mullionDepth: 30,
      })
    );
    const slab = model.getElement(slabId);
    const curtain = model.getElement(curtainId);
    if (slab?.category !== 'SLAB' || curtain?.category !== 'CURTAIN_WALL') {
      throw new Error('Expected slab and curtain wall');
    }
    const panel = curtain.geometry.panels[0];
    if (panel === undefined) throw new Error('Expected panel');
    const original = wallBody(model, target);
    const relationships = model.getAllRelationships();
    for (const owned of [bodySolids(wallBody(model, other))[0], slab.geometry, panel.solid]) {
      using caller = box(10, 10, 10);
      const result = model.takeProductBody(target, {
        kind: 'AUTHORITATIVE',
        items: [caller, owned],
      });
      expect(result).toMatchObject({ ok: false, error: { code: 'BODY_ITEM_OWNERSHIP_CONFLICT' } });
      expect(wallBody(model, target)).toBe(original);
      expect(model.getAllRelationships()).toEqual(relationships);
      expect(unwrap(measureVolume(caller))).toBeCloseTo(1_000, 6);
      expect(owned.disposed).toBe(false);
    }
  });

  it('rejects a valid face as a later Body item before any transfer', () => {
    using model = new BimModel();
    const id = unwrap(model.addWall(WALL));
    const original = model.getElement(id);
    using first = box(10, 10, 10);
    using face = unwrap(
      polygon([
        [0, 0, 0],
        [10, 0, 0],
        [10, 10, 0],
        [0, 10, 0],
      ])
    );
    const result = model.takeProductBody(id, {
      kind: 'AUTHORITATIVE',
      // @ts-expect-error -- Exercise a malformed JavaScript caller with a real valid Face.
      items: [first, face],
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'BODY_ITEM_INVALID' } });
    expect(model.getElement(id)).toBe(original);
    expect(unwrap(measureVolume(first))).toBeCloseTo(1_000, 6);
    expect(face.disposed).toBe(false);
  });

  it('preserves an already-cut opening, identity, Placement, metadata and relationships on replacement', async () => {
    using model = new BimModel();
    unwrap(model.init({ name: 'Body replacement', projectId: 'body-replacement' }));
    const id = unwrap(
      model.addWall(
        { ...WALL, origin: [500, 1_000, 2_000], axisX: [0, 1, 0] },
        { stableKey: 'W-01' }
      )
    );
    unwrap(
      model.addDoor({
        wallLocalId: id,
        width: 100,
        height: 200,
        offsetAlongWall: 100,
        offsetFromFloor: 0,
        materialName: 'Wood',
      })
    );
    const style = { name: 'Concrete', r: 0.4, g: 0.5, b: 0.6 };
    model.setSurfaceStyle(id, style);
    const before = model.getElement(id);
    const relationships = model.getAllRelationships();
    const authored = unwrap(clone(bodySolids(wallBody(model, id))[0]));
    const expectedVolume = 1_000 * 100 * 500 - 100 * 100 * 200;
    const release = vi.spyOn(bodySolids(wallBody(model, id))[0], Symbol.dispose);
    unwrap(model.takeProductBody(id, { kind: 'AUTHORITATIVE', items: [authored] }));
    const after = model.getElement(id);
    expect(after).toEqual({ ...before, geometry: { kind: 'AUTHORITATIVE', items: [authored] } });
    expect(model.getAllRelationships()).toEqual(relationships);
    expect(model.getSurfaceStyle(id)).toBe(style);
    expect(release).toHaveBeenCalledTimes(1);
    release.mockRestore();
    expect(unwrap(measureProductBodyVolume(wallBody(model, id)))).toBeCloseTo(expectedVolume, 4);

    const bytes = unwrap(
      await toIfc(model, { applicationName: 'body-foundation', applicationVersion: '1' })
    );
    const imported = unwrap(await fromIfc(bytes));
    try {
      const wall = imported.elements.find((element) => element.guid === after?.guid);
      expect(wall?.geometry.completeness).toBe('COMPLETE');
      expect(wall?.geometry.volumeMm3).toBeCloseTo(expectedVolume, 1);
      expect(wall?.psets.find((pset) => pset.name === 'Pset_Project')?.properties['Mark']).toBe(
        'W-01'
      );
      expect(model.getAllRelationships()).toEqual(relationships);
      expect(wallBody(model, id).kind).toBe('AUTHORITATIVE');
    } finally {
      disposeImportedModel(imported);
    }
  });

  it.each([
    { offset: 50, expectedVolume: 1_500_000 },
    { offset: 200, expectedVolume: 2_000_000 },
  ])(
    'exports every PARAMETRIC item at offset $offset and measures occupied material',
    async ({ offset, expectedVolume }) => {
      using model = new BimModel();
      unwrap(model.init({ name: 'Parametric items', projectId: 'parametric-items' }));
      const id = unwrap(model.addWall(WALL));
      const first = box(100, 100, 100);
      using seed = box(100, 100, 100);
      const second = translate(seed, [offset, 0, 0]);
      unwrap(model.takeProductBody(id, { kind: 'PARAMETRIC', items: [first, second] }));
      const stored = wallBody(model, id);
      expect(unwrap(measureProductBodyVolume(stored))).toBeCloseTo(expectedVolume, 5);
      expect(bodySolids(stored)).toEqual([first, second]);

      const bytes = unwrap(
        await toIfc(model, { applicationName: 'body-foundation', applicationVersion: '1' })
      );
      const imported = unwrap(await fromIfc(bytes));
      try {
        const wall = imported.elements.find((element) => element.category === 'WALL');
        expect(wall?.geometry.completeness).toBe('COMPLETE');
        expect(wall?.geometry.solids).toHaveLength(2);
        expect(wall?.geometry.volumeMm3).toBeCloseTo(expectedVolume, 1);
        const items = wall?.geometry.solids;
        if (items === undefined || items[0] === undefined || items[1] === undefined)
          throw new Error('Missing imported items');
        expect(getBounds(items[0]).xMin).toBeCloseTo(0, 3);
        expect(getBounds(items[1]).xMin).toBeCloseTo(offset, 3);
        const qto = wall?.psets.find((pset) => pset.name === 'Qto_WallBaseQuantities');
        expect(qto?.properties['NetVolume']).toBeCloseTo(expectedVolume / 1e9, 10);
        expect(qto?.properties['NetWeight']).toBeCloseTo((expectedVolume / 1e9) * 2_400, 8);
        expect(wallBody(model, id)).toBe(stored);
        expect(bodySolids(stored)).toEqual([first, second]);
      } finally {
        disposeImportedModel(imported);
      }
    }
  );

  it('cuts every PARAMETRIC item and keeps an unaffected disconnected item', () => {
    using model = new BimModel();
    const id = unwrap(model.addWall(WALL));
    const first = box(400, 100, 500);
    using seed = box(400, 100, 500);
    const second = translate(seed, [600, 0, 0]);
    unwrap(model.takeProductBody(id, { kind: 'PARAMETRIC', items: [first, second] }));
    unwrap(
      model.addDoor({
        wallLocalId: id,
        width: 100,
        height: 200,
        offsetAlongWall: 100,
        offsetFromFloor: 0,
        materialName: 'Wood',
      })
    );
    const result = wallBody(model, id);
    expect(result.kind).toBe('PARAMETRIC');
    expect(result.items).toHaveLength(2);
    expect(unwrap(measureVolume(result.items[0]))).toBeCloseTo(18_000_000, 4);
    const later = result.items[1];
    if (later === undefined) throw new Error('Missing later item');
    expect(unwrap(measureVolume(later))).toBeCloseTo(20_000_000, 4);
    expect(first.disposed).toBe(true);
    expect(second.disposed).toBe(true);
  });

  it.each([1, 2])(
    'uses material density only when %i declared layers establish a whole-Body density',
    async (layerCount) => {
      using model = new BimModel();
      unwrap(model.init({ name: 'Body material', projectId: 'body-material' }));
      const id = unwrap(
        model.addWall({
          ...WALL,
          materialLayers: Array.from({ length: layerCount }, (_, index) => ({
            name: `Supplied material ${index}`,
            thicknessMm: 100 / layerCount,
            densityKgM3: 1_234 + index * 1_000,
          })),
        })
      );
      const item = box(100, 100, 100);
      unwrap(model.takeProductBody(id, { kind: 'AUTHORITATIVE', items: [item] }));
      const bytes = unwrap(
        await toIfc(model, { applicationName: 'body-foundation', applicationVersion: '1' })
      );
      const imported = unwrap(await fromIfc(bytes));
      try {
        const wall = imported.elements.find((element) => element.category === 'WALL');
        const quantities = wall?.psets.find((pset) => pset.name === 'Qto_WallBaseQuantities');
        expect(quantities?.properties['NetVolume']).toBeCloseTo(0.001, 10);
        if (layerCount === 1) {
          expect(quantities?.properties['NetWeight']).toBeCloseTo(1.234, 8);
        } else {
          expect(quantities?.properties).not.toHaveProperty('NetWeight');
        }
      } finally {
        disposeImportedModel(imported);
      }
    }
  );
});
