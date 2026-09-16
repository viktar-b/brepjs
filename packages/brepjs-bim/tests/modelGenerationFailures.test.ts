import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import * as brepjs from 'brepjs';
import { BimModel } from '../src/model/bimModel.js';
import type { CurtainWallSpec } from '../src/specs/curtainWallSpec.js';
import type { RailingSpec } from '../src/specs/railingSpec.js';
import type { BimError } from '../src/errors/bimError.js';
import type { LocalId } from '../src/identity/localId.js';
import { currentKernel, initKernel } from '../../../tests/setup.js';
import { nativeShapeCount } from './helpers/nativeArena.js';

beforeAll(async () => {
  await initKernel();
}, 30000);
afterEach(() => vi.restoreAllMocks());
const arena = () => (currentKernel === 'occt-wasm' ? nativeShapeCount() : null);
function expectArena(count: number | null) {
  if (count !== null) expect(nativeShapeCount()).toBe(count);
}
const CURTAIN: CurtainWallSpec = {
  width: 10,
  height: 10,
  columns: 2,
  rows: 2,
  panelThickness: 0.1,
  mullionWidth: 1,
  mullionDepth: 1,
  origin: [0, 0, 0],
  axisX: [1, 0, 0],
  axisZ: [0, 0, 1],
  materialName: 'Glass',
};
const RAILING = {
  length: 2000,
  height: 1000,
  thickness: 50,
  infill: 'POSTED',
  origin: [0, 0, 0],
  axisX: [1, 0, 0],
  axisZ: [0, 0, 1],
  materialName: 'Steel',
} satisfies RailingSpec;

type Creator = (model: BimModel) => brepjs.Result<LocalId, BimError>;
const profile = { kind: 'RECTANGULAR', width: 1, height: 1 } as const;
const validationCreators: ReadonlyArray<readonly [string, Creator]> = [
  ['Wall', (model) => model.addWall(RAILING)],
  ['Slab', (model) => model.addSlab({ ...RAILING, width: 10, predefinedType: 'FLOOR' })],
  ['Beam', (model) => model.addBeam({ ...RAILING, profile })],
  ['Column', (model) => model.addColumn({ ...RAILING, profile })],
  ['Space', (model) => model.addSpace({ ...RAILING, width: 10, name: 'Room' })],
  ['Roof', (model) => model.addRoof({ ...RAILING, width: 10, predefinedType: 'FLAT_ROOF' })],
  ['Footing', (model) => model.addFooting({ ...RAILING, width: 10 })],
  ['Pile', (model) => model.addPile({ ...RAILING, profile })],
  ['Covering', (model) => model.addCovering({ ...RAILING, width: 10 })],
  ['Panel railing', (model) => model.addRailing({ ...RAILING, infill: 'PANEL' })],
];

it.each(validationCreators)(
  'releases the generated %s output when its native validity check throws',
  (_, create) => {
    const model = new BimModel();
    const baseline = arena();
    const extrude = brepjs.extrude;
    const outputs: brepjs.Solid[] = [];
    vi.spyOn(brepjs, 'extrude').mockImplementation((...args) => {
      const result = extrude(...args);
      if (result.ok) outputs.push(result.value);
      return result;
    });
    const cause = new Error('Generated solid validation');
    const validation = vi.spyOn(brepjs.getKernel(), 'isValid').mockImplementation(() => {
      throw cause;
    });
    try {
      const result = create(model);
      expect(result).toMatchObject({ ok: false, error: { cause } });
      expect(outputs.length).toBeGreaterThan(0);
      expect(outputs.every((solid) => solid.disposed)).toBe(true);
      expect(model.getAllElements()).toEqual([]);
      expect(model.getAllRelationships()).toEqual([]);
      model[Symbol.dispose]();
      expectArena(baseline);
    } finally {
      validation.mockRestore();
      model[Symbol.dispose]();
      for (const solid of outputs) if (!solid.disposed) solid[Symbol.dispose]();
    }
  }
);

it('reclaims every partial curtain-wall solid after a later native validity throw and leaves the stable key reusable', () => {
  const model = new BimModel();
  const baseline = arena();
  const kernel = brepjs.getKernel();
  const isValid = kernel.isValid.bind(kernel);
  const extrude = brepjs.extrude;
  const outputs: brepjs.Solid[] = [];
  vi.spyOn(brepjs, 'extrude').mockImplementation((...args) => {
    const result = extrude(...args);
    if (result.ok) outputs.push(result.value);
    return result;
  });
  let calls = 0;
  const cause = new Error('Second panel native validation');
  const validation = vi.spyOn(kernel, 'isValid').mockImplementation((raw) => {
    if (++calls === 2) throw cause;
    return isValid(raw);
  });
  try {
    const result = model.addCurtainWall(CURTAIN, { stableKey: 'retry' });
    validation.mockRestore();
    expect(result).toMatchObject({ ok: false, error: { cause } });
    expect(outputs).toHaveLength(2);
    expect(outputs.every((solid) => solid.disposed)).toBe(true);
    expect(model.getAllElements()).toEqual([]);
    expect(model.getAllRelationships()).toEqual([]);
    expectArena(baseline);
    expect(model.addCurtainWall(CURTAIN, { stableKey: 'retry' })).toMatchObject({ ok: true });
    model[Symbol.dispose]();
    expectArena(baseline);
  } finally {
    validation.mockRestore();
    model[Symbol.dispose]();
    // Red-phase fixture repair only; successful production cleanup is not repeated.
    for (const solid of outputs) if (!solid.disposed) solid[Symbol.dispose]();
  }
});

it.each(['before', 'after'] as const)(
  'preserves a POSTED generator cleanup failure %s native release in the Result and model diagnostics',
  (timing) => {
    const model = new BimModel();
    const baseline = arena();
    const originalBox = brepjs.box;
    const cause = new Error(`Generated bar cleanup failed ${timing} native release`);
    let releaseFixture: (() => void) | undefined;
    let attempts = 0;
    vi.spyOn(brepjs, 'box').mockImplementation((...args) => {
      const solid = originalBox(...args);
      if (releaseFixture === undefined) {
        const realRelease = solid[Symbol.dispose].bind(solid);
        releaseFixture = realRelease;
        vi.spyOn(solid, Symbol.dispose).mockImplementation(() => {
          attempts++;
          if (timing === 'after') realRelease();
          throw cause;
        });
      }
      return solid;
    });
    try {
      const result = model.addRailing(RAILING, { stableKey: 'retry' });
      expect(result).toMatchObject({
        ok: false,
        error: {
          code: 'RAILING_CLEANUP_FAILED',
          metadata: {
            cleanup: {
              kind: 'FAILED',
              diagnostics: [{ operation: 'railingToSolid', itemIndex: 0, cause }],
            },
          },
        },
      });
      const diagnostics = model.getGeometryCleanupDiagnostics();
      expect(diagnostics).toMatchObject([{ operation: 'railingToSolid', itemIndex: 0, cause }]);
      expect(Object.isFrozen(diagnostics)).toBe(true);
      expect(Object.isFrozen(diagnostics[0])).toBe(true);
      expect(model.getAllElements()).toEqual([]);
      expect(model.getAllRelationships()).toEqual([]);
      expect(model.addRailing(RAILING, { stableKey: 'retry' })).toMatchObject({ ok: true });
      expect(diagnostics).toHaveLength(1);
      model[Symbol.dispose]();
      model[Symbol.dispose]();
      expect(attempts).toBe(1);
      if (baseline !== null)
        expect(nativeShapeCount()).toBe(baseline + (timing === 'before' ? 1 : 0));
    } finally {
      model[Symbol.dispose]();
      // Explicitly repair the uncertain resource owned by this fault-injection fixture.
      if (timing === 'before') releaseFixture?.();
    }
    expectArena(baseline);
  }
);

it.each(['before', 'after'] as const)(
  'releases curtain outputs when temporary profile cleanup fails %s native release',
  (timing) => {
    const model = new BimModel();
    const baseline = arena();
    const polygon = brepjs.polygon;
    const cause = new Error(`Profile cleanup ${timing} release`);
    let fixtureRelease: (() => void) | undefined;
    let attempts = 0;
    vi.spyOn(brepjs, 'polygon').mockImplementation((...args) => {
      const result = polygon(...args);
      if (result.ok && fixtureRelease === undefined) {
        const release = result.value[Symbol.dispose].bind(result.value);
        fixtureRelease = release;
        vi.spyOn(result.value, Symbol.dispose).mockImplementation(() => {
          attempts++;
          if (timing === 'after') release();
          throw cause;
        });
      }
      return result;
    });
    try {
      expect(model.addCurtainWall(CURTAIN)).toMatchObject({
        ok: false,
        error: {
          code: 'CURTAIN_WALL_CLEANUP_FAILED',
          metadata: {
            cleanup: {
              kind: 'FAILED',
              diagnostics: [{ operation: 'curtainWallToGrid', itemIndex: 0, cause }],
            },
          },
        },
      });
      expect(model.getGeometryCleanupDiagnostics()).toMatchObject([
        { operation: 'curtainWallToGrid', itemIndex: 0, cause },
      ]);
      expect(model.getAllElements()).toEqual([]);
      model[Symbol.dispose]();
      model[Symbol.dispose]();
      expect(attempts).toBe(1);
      if (baseline !== null)
        expect(nativeShapeCount()).toBe(baseline + (timing === 'before' ? 1 : 0));
    } finally {
      model[Symbol.dispose]();
      if (timing === 'before') fixtureRelease?.();
    }
    expectArena(baseline);
  }
);

it('preserves the primary generation failure and every cleanup diagnostic when multiple partial outputs throw after release', () => {
  const model = new BimModel();
  const baseline = arena();
  const kernel = brepjs.getKernel();
  const isValid = kernel.isValid.bind(kernel);
  const extrude = brepjs.extrude;
  const primary = new Error('Second panel validation');
  const cleanupCause = new Error('Partial solid cleanup');
  let validations = 0;
  let attempts = 0;
  vi.spyOn(kernel, 'isValid').mockImplementation((raw) => {
    if (++validations === 2) throw primary;
    return isValid(raw);
  });
  vi.spyOn(brepjs, 'extrude').mockImplementation((...args) => {
    const result = extrude(...args);
    if (result.ok) {
      const release = result.value[Symbol.dispose].bind(result.value);
      vi.spyOn(result.value, Symbol.dispose).mockImplementation(() => {
        attempts++;
        release();
        throw cleanupCause;
      });
    }
    return result;
  });
  const result = model.addCurtainWall(CURTAIN);
  expect(result).toMatchObject({
    ok: false,
    error: {
      cause: primary,
      cleanup: {
        kind: 'FAILED',
        diagnostics: [
          { itemIndex: 0, cause: cleanupCause },
          { itemIndex: 1, cause: cleanupCause },
        ],
      },
    },
  });
  expect(model.getGeometryCleanupDiagnostics()).toHaveLength(2);
  model[Symbol.dispose]();
  model[Symbol.dispose]();
  expect(attempts).toBe(2);
  expectArena(baseline);
});
