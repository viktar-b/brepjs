import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as WebIFC from 'web-ifc';
import { box, fuseAll, getBounds, measureVolume, translate, type ValidSolid } from 'brepjs';
import { initKernel } from '../../../tests/setup.js';
import { deriveIfcGuidSync } from '../src/identity/guidDerivation.js';
import { makeLocalIdCounter } from '../src/identity/localId.js';
import { writeWallEntity } from '../src/ifc-writer/entityWriter.js';
import { writeAxis2Placement3D, writeHeader } from '../src/ifc-writer/headerWriter.js';
import { IfcWriter, type IfcWriterApiForTesting } from '../src/ifc-writer/ifcWriter.js';
import {
  prepareTessellation,
  writePreparedTessellationItem,
  type PreparedTessellation,
} from '../src/ifc-writer/tessellationWriter.js';
import { fromIfc, setFromIfcTestHooksForTesting } from '../src/import/fromIfc.js';
import { setGeometryReadTestHooksForTesting } from '../src/import/geometryRead.js';
import { disposeImportedModel } from '../src/import/importedModel.js';
import { preflightExactBody } from '../src/serialize/exactBodyPreflight.js';
import { deriveExactWallQuantities } from '../src/serialize/exactWallQuantities.js';
import type { WallSpec } from '../src/specs/wallSpec.js';

beforeAll(async () => {
  await initKernel();
}, 30_000);

afterEach(() => {
  setGeometryReadTestHooksForTesting(null);
  setFromIfcTestHooksForTesting(null);
});

const WALL_SPEC: WallSpec = {
  length: 1_000,
  height: 500,
  thickness: 100,
  origin: [0, 0, 0],
  axisX: [1, 0, 0],
  axisZ: [0, 0, 1],
  materialName: 'Concrete',
};

describe('exact Product Body IFC preparation', () => {
  it('reports the failed later item without disposing borrowed source solids', () => {
    using first = box(100, 100, 100);
    using second = box(50, 50, 50);
    const result = preflightExactBody({
      localId: makeLocalIdCounter().next(),
      solids: [first, second],
      prepareItem: (solid) =>
        solid === second
          ? { ok: false, reason: 'injected mesh failure' }
          : prepareTessellation(solid),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('EXACT_BODY_TESSELLATION_FAILED');
    expect(result.error.metadata?.['itemIndex']).toBe(1);
    expect(first.disposed).toBe(false);
    expect(second.disposed).toBe(false);
  });
});

describe('exact wall quantities', () => {
  it('uses a temporary union so overlapping solids are not double-counted', () => {
    using first = box(100, 100, 100);
    using source = box(100, 100, 100);
    using second = translate(source, [50, 0, 0]);
    let unionDisposals = 0;
    const quantities = deriveExactWallQuantities({
      spec: WALL_SPEC,
      solids: [first, second],
      dependencies: {
        fuse: (solids, options) => {
          const result = fuseAll(solids, options);
          if (result.ok) result.value.onDispose(() => unionDisposals++);
          return result;
        },
      },
    });

    expect(quantities.ok).toBe(true);
    if (!quantities.ok) return;
    expect(quantities.value.netVolumeM3).toBeCloseTo(1_500_000 / 1_000_000_000, 12);
    expect(unionDisposals).toBe(1);
    expect(first.disposed).toBe(false);
    expect(second.disposed).toBe(false);
  });

  it('disposes the temporary union when measurement throws', () => {
    using first = box(100, 100, 100);
    using second = box(100, 100, 100);
    let unionDisposals = 0;
    const quantities = deriveExactWallQuantities({
      spec: WALL_SPEC,
      solids: [first, second],
      dependencies: {
        fuse: (solids, options) => {
          const result = fuseAll(solids, options);
          if (result.ok) result.value.onDispose(() => unionDisposals++);
          return result;
        },
        measure: () => {
          throw new Error('injected measurement failure');
        },
      },
    });

    expect(quantities.ok).toBe(false);
    if (!quantities.ok) {
      expect(quantities.error.code).toBe('IFC_EXACT_WALL_QUANTITY_DERIVATION_FAILED');
    }
    expect(unionDisposals).toBe(1);
    expect(first.disposed).toBe(false);
    expect(second.disposed).toBe(false);
  });

  it('measures a singleton directly without calling fuseAll', () => {
    using solid = box(100, 100, 100);
    const quantities = deriveExactWallQuantities({
      spec: WALL_SPEC,
      solids: [solid],
      dependencies: {
        fuse: () => {
          throw new Error('singleton must not fuse');
        },
        measure: measureVolume,
      },
    });
    expect(quantities.ok).toBe(true);
  });
});

describe('imported Body completeness and ownership', () => {
  it('keeps .solid as a borrowed alias for a COMPLETE one-solid Body', async () => {
    using solid = box(100, 100, 100);
    const imported = await fromIfc(await bodyFixture({ solids: [solid], unsupportedItems: 0 }));
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    const wall = imported.value.elements.find((element) => element.category === 'WALL');
    expect(wall?.geometry.completeness).toBe('COMPLETE');
    expect(wall?.geometry.solids).toHaveLength(1);
    expect(wall?.geometry.solid).toBe(wall?.geometry.solids[0]);
    expect(wall?.geometry.volumeMm3).toBeCloseTo(1_000_000, 3);
    disposeImportedModel(imported.value);
  });

  it('owns every item in a COMPLETE multi-item World-placed Body', async () => {
    using first = box(100, 100, 100);
    using source = box(50, 50, 50);
    using second = translate(source, [200, 0, 0]);
    const bytes = await bodyFixture({ solids: [first, second], unsupportedItems: 0 });
    const imported = await fromIfc(bytes);
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    const wall = imported.value.elements.find((element) => element.category === 'WALL');
    expect(wall?.geometry.completeness).toBe('COMPLETE');
    expect(wall?.geometry.solids).toHaveLength(2);
    expect(wall?.geometry.solid).toBeNull();
    const bounds = wall?.geometry.solids.map(getBounds) ?? [];
    expect(bounds[0]?.xMin).toBeCloseTo(1_000, 2);
    expect(bounds[0]?.yMin).toBeCloseTo(2_000, 2);
    expect(bounds[0]?.zMin).toBeCloseTo(3_000, 2);
    expect(bounds[1]?.xMin).toBeCloseTo(1_200, 2);
    expect(wall?.geometry.volumeMm3).toBeCloseTo(1_125_000, 2);
    expect(wall?.geometry.bounds?.xMin).toBeCloseTo(1_000, 2);
    expect(wall?.geometry.bounds?.xMax).toBeCloseTo(1_250, 2);
    expect(wall?.geometry.bounds?.yMin).toBeCloseTo(2_000, 2);
    expect(wall?.geometry.bounds?.yMax).toBeCloseTo(2_100, 2);
    expect(wall?.geometry.bounds?.zMin).toBeCloseTo(3_000, 2);
    expect(wall?.geometry.bounds?.zMax).toBeCloseTo(3_100, 2);

    const disposals = wall?.geometry.solids.map(() => 0) ?? [];
    wall?.geometry.solids.forEach((solid, index) => {
      solid.onDispose(() => {
        disposals[index] = (disposals[index] ?? 0) + 1;
      });
    });
    disposeImportedModel(imported.value);
    expect(disposals).toEqual([1, 1]);
  });

  it('retains supported siblings and item diagnostics for a PARTIAL Body', async () => {
    using solid = box(100, 100, 100);
    const bytes = await bodyFixture({ solids: [solid], unsupportedItems: 1 });
    const imported = await fromIfc(bytes);
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    try {
      const wall = imported.value.elements.find((element) => element.category === 'WALL');
      expect(wall?.geometry.completeness).toBe('PARTIAL');
      expect(wall?.geometry.solids).toHaveLength(1);
      expect(wall?.geometry.solid).toBeNull();
      expect(wall?.geometry.bounds).toBeNull();
      expect(wall?.geometry.volumeMm3).toBeNull();
      const codes = imported.value.diagnostics.issues.map((diagnostic) => diagnostic.code);
      expect(codes).toContain('UNSUPPORTED_REPRESENTATION_ITEM');
      expect(codes).toContain('PARTIAL_BODY_RECONSTRUCTION');
    } finally {
      disposeImportedModel(imported.value);
    }
  });

  it('distinguishes an existing Body whose items all fail as NONE', async () => {
    const bytes = await bodyFixture({ solids: [], unsupportedItems: 1 });
    const imported = await fromIfc(bytes);
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    const wall = imported.value.elements.find((element) => element.category === 'WALL');
    expect(wall?.geometry.completeness).toBe('NONE');
    expect(wall?.geometry.solids).toEqual([]);
    expect(wall?.geometry.solid).toBeNull();
    expect(wall?.geometry.bounds).toBeNull();
    expect(wall?.geometry.volumeMm3).toBeNull();
    expect(imported.value.diagnostics.issues.map((diagnostic) => diagnostic.code)).toContain(
      'BODY_RECONSTRUCTION_NONE'
    );
    disposeImportedModel(imported.value);
  });

  it('disposes a later item intermediate while retaining an earlier sibling', async () => {
    using first = box(100, 100, 100);
    using second = box(50, 50, 50);
    const bytes = await bodyFixture({ solids: [first, second], unsupportedItems: 0 });
    const disposals = [0, 0];
    let itemIndex = 0;
    setGeometryReadTestHooksForTesting({
      afterItemSolid: (_expressId, solid) => {
        const current = itemIndex++;
        solid.onDispose(() => {
          disposals[current] = (disposals[current] ?? 0) + 1;
        });
        if (current === 1) throw new Error('injected later item failure');
      },
    });

    const imported = await fromIfc(bytes);
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    const wall = imported.value.elements.find((element) => element.category === 'WALL');
    expect(wall?.geometry.completeness).toBe('PARTIAL');
    expect(wall?.geometry.solids).toHaveLength(1);
    expect(disposals).toEqual([0, 1]);
    disposeImportedModel(imported.value);
    expect(disposals).toEqual([1, 1]);
  });

  it('disposes reconstructed geometry when later element metadata throws', async () => {
    using source = box(100, 100, 100);
    const bytes = await bodyFixture({ solids: [source], unsupportedItems: 0 });
    let disposals = 0;
    setFromIfcTestHooksForTesting({
      afterGeometry: (_expressId, geometry) => {
        geometry.solids[0]?.onDispose(() => disposals++);
        throw new Error('injected metadata failure');
      },
    });

    const imported = await fromIfc(bytes);
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.value.elements).toHaveLength(0);
    expect(disposals).toBe(1);
  });

  it('disposes accumulated element geometry on a fatal model-level failure', async () => {
    using source = box(100, 100, 100);
    const bytes = await bodyFixture({ solids: [source], unsupportedItems: 0 });
    let disposals = 0;
    setFromIfcTestHooksForTesting({
      afterElement: (element) => {
        element.geometry.solids[0]?.onDispose(() => disposals++);
        throw new Error('injected model failure');
      },
    });

    const imported = await fromIfc(bytes);
    expect(imported.ok).toBe(false);
    expect(disposals).toBe(1);
  });
});

describe('IfcWriter cleanup', () => {
  it.each([
    ['save success', false],
    ['save failure', true],
  ])('closes exactly once after %s', (_name, failSave) => {
    const api = new FakeWriterApi({ failSave });
    const writer = IfcWriter.fromApiForTesting(api);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const result = writer.save();
    writer[Symbol.dispose]();
    expect(result.ok).toBe(!failSave);
    expect(api.closeCalls).toBe(1);
    vi.restoreAllMocks();
  });

  it('closes exactly once when a write throws before save', () => {
    const api = new FakeWriterApi({ failWrite: true });
    const writer = IfcWriter.fromApiForTesting(api);
    try {
      expect(() => writer.writeLine({ expressID: 1 })).toThrow('injected write failure');
    } finally {
      writer[Symbol.dispose]();
      writer[Symbol.dispose]();
    }
    expect(api.closeCalls).toBe(1);
  });
});

interface BodyFixtureOptions {
  readonly solids: readonly ValidSolid[];
  readonly unsupportedItems: number;
}

async function bodyFixture(options: BodyFixtureOptions): Promise<Uint8Array> {
  using writer = requiredWriter(await IfcWriter.create());
  const { ownerHistoryId, geomSubContextId } = writeHeader(writer, {
    applicationName: 'exact-body-test',
    applicationVersion: '1',
  });
  const placement3DId = writeAxis2Placement3D(writer, [1, 2, 3]);
  const localPlacementId = writer.nextId();
  writer.writeLine({
    expressID: localPlacementId,
    type: WebIFC.IFCLOCALPLACEMENT,
    PlacementRelTo: null,
    RelativePlacement: writer.ref(placement3DId),
  });

  const itemIds = options.solids.map((solid) =>
    writePreparedTessellationItem(writer, requiredPreparation(prepareTessellation(solid)))
  );
  for (let index = 0; index < options.unsupportedItems; index++) {
    const unsupportedId = writer.nextId();
    writer.writeLine({
      expressID: unsupportedId,
      type: WebIFC.IFCCARTESIANPOINT,
      Coordinates: [
        writer.mkType(WebIFC.IFCLENGTHMEASURE, 0),
        writer.mkType(WebIFC.IFCLENGTHMEASURE, 0),
        writer.mkType(WebIFC.IFCLENGTHMEASURE, 0),
      ],
    });
    itemIds.push(unsupportedId);
  }

  const shapeRepresentationId = writer.nextId();
  writer.writeLine({
    expressID: shapeRepresentationId,
    type: WebIFC.IFCSHAPEREPRESENTATION,
    ContextOfItems: writer.ref(geomSubContextId),
    RepresentationIdentifier: writer.mkType(WebIFC.IFCLABEL, 'Body'),
    RepresentationType: writer.mkType(WebIFC.IFCLABEL, 'Tessellation'),
    Items: itemIds.map((itemId) => writer.ref(itemId)),
  });
  const productDefinitionShapeId = writer.nextId();
  writer.writeLine({
    expressID: productDefinitionShapeId,
    type: WebIFC.IFCPRODUCTDEFINITIONSHAPE,
    Name: null,
    Description: null,
    Representations: [writer.ref(shapeRepresentationId)],
  });
  writeWallEntity(
    writer,
    deriveIfcGuidSync('exact-body-fixture'),
    'Exact wall',
    ownerHistoryId,
    localPlacementId,
    productDefinitionShapeId
  );
  const saved = writer.save();
  if (!saved.ok) throw new Error(saved.error.message);
  return saved.value;
}

function requiredWriter(result: Awaited<ReturnType<typeof IfcWriter.create>>): IfcWriter {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function requiredPreparation(result: ReturnType<typeof prepareTessellation>): PreparedTessellation {
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}

class FakeWriterApi implements IfcWriterApiForTesting {
  closeCalls = 0;
  readonly #failSave: boolean;
  readonly #failWrite: boolean;

  constructor(options: { readonly failSave?: boolean; readonly failWrite?: boolean }) {
    this.#failSave = options.failSave ?? false;
    this.#failWrite = options.failWrite ?? false;
  }

  WriteLine(): void {
    if (this.#failWrite) throw new Error('injected write failure');
  }

  CreateIfcType(_modelId: number, type: number, value: unknown): Record<string, unknown> {
    return { type, value };
  }

  SaveModel(): Uint8Array {
    if (this.#failSave) throw new Error('injected save failure');
    return new Uint8Array();
  }

  CloseModel(): void {
    this.closeCalls++;
  }
}
