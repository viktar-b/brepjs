import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  box,
  compound,
  csg,
  err,
  fuse,
  getKernel,
  getSolids,
  isSolid,
  kernelError,
  measureVolume,
  ok,
  OcctWasmAdapter,
  polygon,
  translate,
  unwrap,
  withKernel,
  type ValidSolid,
} from 'brepjs';
import { civilSemantics, el, family, resolve, type Element } from 'brepjs-families';
import { initKernel } from '../../../tests/setup.js';
import { BimModel, setBimModelBodyTestHooksForTesting } from '../src/model/bimModel.js';
import { familiesToBim } from '../src/familiesAdapter.js';
import { setFamiliesProductBodyTestHooksForTesting } from '../src/familiesProductBody.js';
import {
  measureProductBodyVolume,
  productBodyFromOwnedShape,
  productBodyItemsFromOwnedShape,
  type NonEmpty,
  type ProductBody,
} from '../src/types/productBody.js';
import type { LocalId } from '../src/identity/localId.js';

beforeAll(async () => {
  await initKernel('occt-wasm');
}, 30_000);

afterEach(() => {
  setBimModelBodyTestHooksForTesting(null);
  setFamiliesProductBodyTestHooksForTesting(null);
  vi.restoreAllMocks();
});

const WALL_SPEC = {
  length: 1_000,
  height: 500,
  thickness: 100,
  origin: [0, 0, 0],
  axisX: [1, 0, 0],
  axisZ: [0, 0, 1],
  materialName: 'Concrete',
} satisfies Parameters<BimModel['addWall']>[0];

function arenaCount(): number {
  const kernel = getKernel();
  if (!(kernel instanceof OcctWasmAdapter)) throw new Error('Expected the occt-wasm kernel');
  const raw = kernel.retainedKernelOwner?.getRawKernel();
  if (
    typeof raw !== 'object' ||
    raw === null ||
    !('getShapeCount' in raw) ||
    typeof raw.getShapeCount !== 'function'
  ) {
    throw new Error('Native shape arena counter unavailable');
  }
  const count: unknown = Reflect.apply(raw.getShapeCount, raw, []);
  if (typeof count !== 'number') throw new Error('Native shape arena counter is not a number');
  return count;
}

function wallBody(model: BimModel, localId: LocalId): ProductBody {
  const wall = model.getElement(localId);
  if (wall?.category !== 'WALL') throw new Error('Expected a wall');
  return wall.geometry;
}

function shiftedBox(x: number, length = 10, width = 10, height = 10): ValidSolid {
  using source = box(length, width, height);
  return translate(source, [x, 0, 0]);
}

function observeDisposal(shape: Disposable & { onDispose(callback: () => void): void }) {
  const callback = vi.fn();
  shape.onDispose(callback);
  return { callback, dispose: vi.spyOn(shape, Symbol.dispose) };
}

describe('ProductBody native arena ownership', () => {
  for (const kind of ['AUTHORITATIVE', 'PARAMETRIC'] as const) {
    it(`adopts and disposes ${kind} items through one model owner`, () => {
      withKernel('occt-wasm', () => {
        const baseline = arenaCount();
        const model = new BimModel();
        const wallId = unwrap(model.addWall(WALL_SPEC));
        const previous = observeDisposal(wallBody(model, wallId).items[0]);
        const items: NonEmpty<ValidSolid> =
          kind === 'AUTHORITATIVE' ? [box(10, 10, 10)] : [box(10, 10, 10), shiftedBox(20)];
        const disposals = items.map(observeDisposal);

        unwrap(model.takeProductBody(wallId, { kind, items }));
        expect(wallBody(model, wallId).kind).toBe(kind);
        expect(wallBody(model, wallId).items).toEqual(items);
        expect(previous.callback).toHaveBeenCalledTimes(1);
        expect(previous.dispose).toHaveBeenCalledTimes(1);
        for (const item of items) expect(unwrap(measureVolume(item))).toBeCloseTo(1_000, 6);

        model[Symbol.dispose]();
        model[Symbol.dispose]();
        for (const observed of disposals) {
          expect(observed.callback).toHaveBeenCalledTimes(1);
          expect(observed.dispose).toHaveBeenCalledTimes(1);
        }
        expect(arenaCount()).toBe(baseline);
      });
    });
  }

  it('retains the previous model and caller inputs when a later item validation throws', () => {
    withKernel('occt-wasm', () => {
      const baseline = arenaCount();
      const model = new BimModel();
      const wallId = unwrap(model.addWall(WALL_SPEC));
      const originalBody = wallBody(model, wallId);
      const previous = observeDisposal(originalBody.items[0]);
      const elements = model.getAllElements();
      const relationships = model.getAllRelationships();
      const first = box(10, 10, 10);
      const second = shiftedBox(20);
      const disposals = [first, second].map(observeDisposal);
      const beforeAttempt = arenaCount();
      const kernel = getKernel();
      const isValid = kernel.isValid.bind(kernel);
      const validation = vi.spyOn(kernel, 'isValid').mockImplementation((shape) => {
        if (shape === second.wrapped) throw new Error('injected later item validation failure');
        return isValid(shape);
      });

      const result = model.takeProductBody(wallId, {
        kind: 'AUTHORITATIVE',
        items: [first, second],
      });
      validation.mockRestore();

      expect(result.ok).toBe(false);
      expect(wallBody(model, wallId)).toBe(originalBody);
      expect(model.getAllElements()).toEqual(elements);
      expect(model.getAllRelationships()).toEqual(relationships);
      expect(arenaCount()).toBe(beforeAttempt);
      expect(previous.dispose).not.toHaveBeenCalled();
      for (const item of [first, second]) expect(unwrap(measureVolume(item))).toBeCloseTo(1_000, 6);
      for (const observed of disposals) expect(observed.dispose).not.toHaveBeenCalled();

      model[Symbol.dispose]();
      first[Symbol.dispose]();
      second[Symbol.dispose]();
      expect(previous.dispose).toHaveBeenCalledTimes(1);
      for (const observed of disposals) {
        expect(observed.callback).toHaveBeenCalledTimes(1);
        expect(observed.dispose).toHaveBeenCalledTimes(1);
      }
      expect(arenaCount()).toBe(baseline);
    });
  });
});

describe('ProductBody occupied volume native cleanup', () => {
  for (const { label, offset, expected } of [
    { label: 'overlapping', offset: 5, expected: 1_500 },
    { label: 'disconnected', offset: 20, expected: 2_000 },
  ]) {
    it(`measures ${label} authored items without retaining temporary native slots`, () => {
      withKernel('occt-wasm', () => {
        const baseline = arenaCount();
        const model = new BimModel();
        const wallId = unwrap(model.addWall(WALL_SPEC));
        unwrap(
          model.takeProductBody(wallId, {
            kind: 'PARAMETRIC',
            items: [box(10, 10, 10), shiftedBox(offset)],
          })
        );
        const body = wallBody(model, wallId);
        const held = arenaCount();
        for (let iteration = 0; iteration < 5; iteration++) {
          expect(unwrap(measureProductBodyVolume(body))).toBeCloseTo(expected, 6);
          expect(arenaCount()).toBe(held);
        }
        expect(body.items).toHaveLength(2);
        for (const item of body.items) expect(unwrap(measureVolume(item))).toBeCloseTo(1_000, 6);
        model[Symbol.dispose]();
        expect(arenaCount()).toBe(baseline);
      });
    });
  }

  it('releases every temporary union when final measurement throws', () => {
    withKernel('occt-wasm', () => {
      const baseline = arenaCount();
      using first = box(10, 10, 10);
      using second = shiftedBox(5);
      using third = shiftedBox(10);
      const body: ProductBody = { kind: 'AUTHORITATIVE', items: [first, second, third] };
      const held = arenaCount();
      const unions: ReturnType<typeof observeDisposal>[] = [];

      const result = measureProductBodyVolume(body, {
        measure: (union) => {
          unions.push(observeDisposal(union));
          throw new Error('injected final union measurement failure');
        },
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('BODY_VOLUME_UNAVAILABLE');
      expect(unions).toHaveLength(1);
      for (const observed of unions) {
        expect(observed.callback).toHaveBeenCalledTimes(1);
        expect(observed.dispose).toHaveBeenCalledTimes(1);
      }
      expect(arenaCount()).toBe(held);
      for (const item of body.items) expect(unwrap(measureVolume(item))).toBeCloseTo(1_000, 6);
      expect(held).toBeGreaterThan(baseline);
    });
  });

  it('releases an earlier native union when the later fuse throws', () => {
    withKernel('occt-wasm', () => {
      using first = box(10, 10, 10);
      using second = shiftedBox(5);
      using third = shiftedBox(10);
      const held = arenaCount();
      const kernel = getKernel();
      const fuse = kernel.fuse.bind(kernel);
      const calls = vi
        .spyOn(kernel, 'fuse')
        .mockImplementationOnce(fuse)
        .mockImplementationOnce(() => {
          throw new Error('injected later union failure');
        });

      const result = measureProductBodyVolume({
        kind: 'PARAMETRIC',
        items: [first, second, third],
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('BODY_VOLUME_UNAVAILABLE');
      expect(calls).toHaveBeenCalledTimes(2);
      expect(arenaCount()).toBe(held);
      for (const item of [first, second, third]) {
        expect(unwrap(measureVolume(item))).toBeCloseTo(1_000, 6);
      }
    });
  });

  for (const { label, result } of [
    { label: 'an error Result', result: err(kernelError('MEASUREMENT_FAILED', 'injected error')) },
    { label: 'zero', result: ok(0) },
    { label: 'NaN', result: ok(Number.NaN) },
  ]) {
    it(`reports unavailable volume and releases the union when measurement returns ${label}`, () => {
      withKernel('occt-wasm', () => {
        using first = box(10, 10, 10);
        using second = shiftedBox(5);
        const held = arenaCount();
        const unions: ReturnType<typeof observeDisposal>[] = [];
        const measured = measureProductBodyVolume(
          { kind: 'PARAMETRIC', items: [first, second] },
          {
            measure: (union) => {
              unions.push(observeDisposal(union));
              return result;
            },
          }
        );

        expect(measured.ok).toBe(false);
        if (!measured.ok) expect(measured.error.code).toBe('BODY_VOLUME_UNAVAILABLE');
        expect(unions).toHaveLength(1);
        for (const observed of unions) {
          expect(observed.callback).toHaveBeenCalledTimes(1);
          expect(observed.dispose).toHaveBeenCalledTimes(1);
        }
        expect(arenaCount()).toBe(held);
        expect(unwrap(measureVolume(first))).toBeCloseTo(1_000, 6);
        expect(unwrap(measureVolume(second))).toBeCloseTo(1_000, 6);
      });
    });
  }
});

describe('ProductBody partial native results', () => {
  it.each(['face', 'compound'] as const)(
    'rejects and releases a generated %s containing non-solid geometry',
    (kind) => {
      withKernel('occt-wasm', () => {
        const baseline = arenaCount();
        const face = unwrap(
          polygon([
            [0, 0, 0],
            [10, 0, 0],
            [10, 10, 0],
            [0, 10, 0],
          ])
        );
        const generated = kind === 'face' ? face : compound([face]);
        if (kind === 'compound') face[Symbol.dispose]();
        const disposal = observeDisposal(generated);

        // @ts-expect-error -- A malformed Boolean result must not be treated as an empty cut.
        const result = productBodyItemsFromOwnedShape(generated);

        expect(result).toMatchObject({ ok: false, error: { code: 'BODY_ITEM_INVALID' } });
        expect(disposal.dispose).toHaveBeenCalledTimes(1);
        expect(disposal.callback).toHaveBeenCalledTimes(1);
        expect(arenaCount()).toBe(baseline);
      });
    }
  );

  it.each([400, 1_000])(
    'applies the nonempty invariant to the whole Body after a %i mm opening',
    (width) => {
      withKernel('occt-wasm', () => {
        const baseline = arenaCount();
        const model = new BimModel();
        const id = unwrap(model.addWall(WALL_SPEC));
        unwrap(
          model.takeProductBody(id, {
            kind: 'PARAMETRIC',
            items: [box(400, 100, 500), shiftedBox(400, 600, 100, 500)],
          })
        );
        const original = wallBody(model, id);
        const elements = model.getAllElements();
        const relationships = model.getAllRelationships();
        const held = arenaCount();
        const cuts: ReturnType<typeof observeDisposal>[] = [];
        setBimModelBodyTestHooksForTesting({
          afterCut: (_index, shape) => cuts.push(observeDisposal(shape)),
        });
        const result = model.addDoor({
          wallLocalId: id,
          width,
          height: 500,
          offsetAlongWall: 0,
          offsetFromFloor: 0,
          materialName: 'Timber',
        });
        expect(cuts).toHaveLength(2);
        for (const cut of cuts) expect(cut.dispose).toHaveBeenCalledTimes(1);
        if (width === 400) {
          expect(result.ok).toBe(true);
          expect(wallBody(model, id).items).toHaveLength(1);
          expect(unwrap(measureProductBodyVolume(wallBody(model, id)))).toBeCloseTo(30_000_000, 3);
          expect(
            model.getAllRelationships().filter((rel) => rel.kind === 'VOIDS_WALL')
          ).toHaveLength(1);
          for (const item of original.items) expect(item.disposed).toBe(true);
        } else {
          expect(result).toMatchObject({ ok: false, error: { code: 'BODY_EMPTY' } });
          expect(wallBody(model, id)).toBe(original);
          expect(model.getAllElements()).toEqual(elements);
          expect(model.getAllRelationships()).toEqual(relationships);
          expect(arenaCount()).toBe(held);
          for (const item of original.items) expect(item.disposed).toBe(false);
        }
        model[Symbol.dispose]();
        expect(arenaCount()).toBe(baseline);
      });
    }
  );

  for (const failedItem of [0, 1]) {
    it(`releases generated compound copies when validation throws at item ${failedItem}`, () => {
      withKernel('occt-wasm', () => {
        using first = box(10, 10, 10);
        using second = shiftedBox(20);
        const inputs = [first, second].map(observeDisposal);
        const held = arenaCount();
        const generated = unwrap(fuse(first, second, { trackEvolution: false }));
        expect(isSolid(generated)).toBe(false);
        const generatedDisposal = observeDisposal(generated);
        const kernel = getKernel();
        const isValid = kernel.isValid.bind(kernel);
        let validated = 0;
        const validation = vi.spyOn(kernel, 'isValid').mockImplementation((shape) => {
          if (validated++ === failedItem)
            throw new Error('injected generated copy validation failure');
          return isValid(shape);
        });

        const result = productBodyFromOwnedShape('PARAMETRIC', generated);
        validation.mockRestore();

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe('BODY_ITEM_COPY_FAILED');
        expect(validated).toBe(failedItem + 1);
        expect(generatedDisposal.callback).toHaveBeenCalledTimes(1);
        expect(generatedDisposal.dispose).toHaveBeenCalledTimes(1);
        expect(arenaCount()).toBe(held);
        for (const observed of inputs) expect(observed.dispose).not.toHaveBeenCalled();
        expect(unwrap(measureVolume(first))).toBeCloseTo(1_000, 6);
        expect(unwrap(measureVolume(second))).toBeCloseTo(1_000, 6);
      });
    });
  }

  it('releases later-item opening results and preserves the existing wall and relationships', () => {
    withKernel('occt-wasm', () => {
      const baseline = arenaCount();
      const model = new BimModel();
      const wallId = unwrap(model.addWall(WALL_SPEC));
      unwrap(
        model.takeProductBody(wallId, {
          kind: 'PARAMETRIC',
          items: [box(500, 100, 500), shiftedBox(500, 500, 100, 500)],
        })
      );
      const body = wallBody(model, wallId);
      const elements = model.getAllElements();
      const relationships = model.getAllRelationships();
      const held = arenaCount();
      const cuts: ReturnType<typeof observeDisposal>[] = [];
      setBimModelBodyTestHooksForTesting({
        afterCut: (itemIndex, solid) => {
          cuts.push(observeDisposal(solid));
          if (itemIndex === 1) throw new Error('injected later opening item failure');
        },
      });

      const result = model.addDoor({
        wallLocalId: wallId,
        width: 200,
        height: 200,
        offsetAlongWall: 400,
        offsetFromFloor: 0,
        materialName: 'Timber',
      });

      expect(result.ok).toBe(false);
      expect(cuts).toHaveLength(2);
      for (const observed of cuts) {
        expect(observed.callback).toHaveBeenCalledTimes(1);
        expect(observed.dispose).toHaveBeenCalledTimes(1);
      }
      expect(wallBody(model, wallId)).toBe(body);
      expect(model.getAllElements()).toEqual(elements);
      expect(model.getAllRelationships()).toEqual(relationships);
      expect(arenaCount()).toBe(held);
      for (const item of body.items) expect(unwrap(measureVolume(item))).toBeCloseTo(25_000_000, 6);
      model[Symbol.dispose]();
      expect(arenaCount()).toBe(baseline);
    });
  });

  it('releases partial Families copies while keeping evaluator-owned source items usable', () => {
    withKernel('occt-wasm', () => {
      const baseline = arenaCount();
      const Rail = family(
        'NativeArenaRailing',
        () =>
          el('Geometry', {
            node: csg.compound([
              csg.box(1_000, 100, 50),
              csg.translate(csg.box(1_000, 100, 50), [0, 0, 450]),
            ]),
          }),
        {
          semantics: civilSemantics({
            kind: 'product',
            category: 'railing',
            role: 'guardrail',
            material: 'Steel',
            dimensionsMm: { length: 1_000, width: 100, height: 500 },
          }),
        }
      );
      const Storey = family<{ readonly children: readonly Element[] }>(
        'NativeArenaStorey',
        ({ children }) => el('Group', {}, children),
        { archetype: 'storey' }
      );
      const root = resolve(Storey({ key: 'level', children: [Rail({ key: 'rail' })] }));
      const occurrence = root.children[0];
      if (occurrence === undefined) throw new Error('Expected a resolved railing');
      const evaluator = new csg.Evaluator();
      const source = unwrap(evaluator.evaluate(occurrence.geometry));
      expect(getSolids(source)).toHaveLength(2);
      const held = arenaCount();
      const copies: ReturnType<typeof observeDisposal>[] = [];
      const localized: ReturnType<typeof observeDisposal>[] = [];
      setFamiliesProductBodyTestHooksForTesting({
        afterCopy: (_index, solid) => copies.push(observeDisposal(solid)),
        afterLocalized: (index, solid) => {
          localized.push(observeDisposal(solid));
          if (index === 1) throw new Error('injected later Families transform failure');
        },
      });

      const result = familiesToBim(root, {
        project: { name: 'Native Body lifecycle', projectId: 'native-body-lifecycle' },
        bodyEvaluator: evaluator,
      });

      expect(result.ok).toBe(false);
      expect(copies).toHaveLength(2);
      expect(localized).toHaveLength(2);
      for (const observed of [...copies, ...localized]) {
        expect(observed.callback).toHaveBeenCalledTimes(1);
        expect(observed.dispose).toHaveBeenCalledTimes(1);
      }
      expect(unwrap(measureVolume(source))).toBeCloseTo(10_000_000, 6);
      expect(arenaCount()).toBe(held);
      evaluator[Symbol.dispose]();
      expect(arenaCount()).toBe(baseline);
    });
  });
});
