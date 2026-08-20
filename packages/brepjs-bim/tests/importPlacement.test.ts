import { unwrap } from 'brepjs';
import { describe, it, expect, beforeAll } from 'vitest';
import * as WebIFC from 'web-ifc';
import { initOCCT } from '../../../tests/setup.js';
import { BimModel } from '../src/model/bimModel.js';
import { toIfc } from '../src/serialize/toIfc.js';
import { deriveIfcGuidSync } from '../src/identity/guidDerivation.js';
import { IfcWriter } from '../src/ifc-writer/ifcWriter.js';
import { writeHeader, writeMapConversion } from '../src/ifc-writer/headerWriter.js';
import { writeSite } from '../src/ifc-writer/entityWriter.js';
import { writeBridge, writeBridgePart } from '../src/ifc-writer/infrastructureWriter.js';
import type { IfcLengthUnit } from '../src/ifc-writer/serializationContext.js';
import { SpfReader } from '../src/import/spfReader.js';
import {
  readLengthScale,
  composeWorldPlacement,
  composeWorldMatrix,
  decomposePlacement,
  readGeoref,
  identityMatrix,
} from '../src/import/placement.js';

beforeAll(async () => {
  await initOCCT();
}, 30000);

const META = { applicationName: 'brepjs-bim', applicationVersion: '0.1.0' };

interface PlacedModel {
  readonly model: BimModel;
  readonly wallGuid: string;
  readonly origin: readonly [number, number, number];
  readonly storeyElevation: number;
}

// Builds a project/site/building/storey with one wall placed at a known
// non-trivial origin, rotated so axisX points along world +Y. The storey sits
// at a non-zero elevation so the composed world placement must account for the
// full IfcLocalPlacement chain, not just the wall's relative placement.
function buildPlacedModel(): PlacedModel {
  const model = new BimModel();
  const initResult = model.init({ name: 'Placement Project' });
  if (!initResult.ok) throw new Error(initResult.error.message);
  const projectId = initResult.value;
  const siteId = unwrap(model.addSite({ name: 'Site' }));
  const buildingId = unwrap(model.addBuilding({ name: 'Building' }));
  const storeyElevation = 3500;
  const storeyId = unwrap(model.addStorey({ name: 'L1', elevation: storeyElevation }));
  model.aggregate(projectId, siteId);
  model.aggregate(siteId, buildingId);
  model.aggregate(buildingId, storeyId);

  const origin: [number, number, number] = [1200, -800, 250];
  const wall = model.addWall({
    length: 5000,
    height: 3000,
    thickness: 200,
    origin,
    // Rotate the wall 90 deg about Z: local X points along world +Y.
    axisX: [0, 1, 0],
    axisZ: [0, 0, 1],
    materialName: 'Concrete',
  });
  if (!wall.ok) throw new Error(wall.error.message);
  model.placeIn(wall.value, storeyId);

  const wallGuid = model.getWalls()[0]?.guid;
  if (wallGuid === undefined) throw new Error('wall guid missing');

  return { model, wallGuid, origin, storeyElevation };
}

async function bytesFor(model: BimModel): Promise<Uint8Array> {
  const result = await toIfc(model, META);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

async function openReader(bytes: Uint8Array): Promise<SpfReader> {
  const result = await SpfReader.create(bytes);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

async function spatialContextBytes(lengthUnit: IfcLengthUnit): Promise<Uint8Array> {
  const writer = unwrap(await IfcWriter.create('ReferenceView_v1.2', 'IFC4X3', {}, lengthUnit));
  const header = writeHeader(writer, {
    applicationName: 'spatial-context-fixture',
    applicationVersion: '1',
  });
  writeMapConversion(
    writer,
    {
      name: 'EPSG:TEST',
      verticalDatum: 'TEST-VERTICAL',
      eastings: 17.25,
      northings: 30.5,
      orthogonalHeight: 2.25,
      xAxisAbscissa: 0.5,
      xAxisOrdinate: -0.8660254037844386,
      scale: 1,
    },
    header.geomContextId,
    header.lengthUnitId
  );
  const environmentSite = writeSite(
    writer,
    deriveIfcGuidSync('spatial-context:environment-site'),
    'Environment site',
    header.ownerHistoryId,
    { origin: [1_000, 2_000, 3_000], axisX: [1, 0, 0], axisZ: [0, 0, 1] }
  );
  const bridgeSite = writeSite(
    writer,
    deriveIfcGuidSync('spatial-context:bridge-site'),
    'Bridge site',
    header.ownerHistoryId,
    { origin: [100, 200, 300], axisX: [1, 0, 0], axisZ: [0, 0, 1] },
    environmentSite.placementId
  );
  const bridge = writeBridge(
    writer,
    deriveIfcGuidSync('spatial-context:bridge'),
    {
      name: 'Context bridge',
      origin: [4_000, 5_000, 6_000],
      axisX: [1, 0, 0],
      axisZ: [0, 0, 1],
    },
    header.ownerHistoryId,
    bridgeSite.placementId
  );
  writeBridgePart(
    writer,
    deriveIfcGuidSync('spatial-context:part'),
    {
      name: 'Context part',
      origin: [7_000, 8_000, 9_000],
      axisX: [1, 0, 0],
      axisZ: [0, 0, 1],
      usageType: 'LATERAL',
    },
    header.ownerHistoryId,
    bridge.placementId
  );
  return unwrap(writer.save());
}

function objectPlacementId(reader: SpfReader, elementExpressId: number): number {
  const line = reader.getLine<Record<string, unknown>>(elementExpressId);
  if (line === null) throw new Error('element line missing');
  const op = line['ObjectPlacement'] as { value?: number } | undefined;
  if (op?.value === undefined) throw new Error('ObjectPlacement missing');
  return op.value;
}

function entityIdByName(reader: SpfReader, type: number, name: string): number {
  const id = reader.getLinesOfType(type).find((candidate) => {
    const line = reader.getLine<Record<string, unknown>>(candidate);
    return (line?.['Name'] as { value?: string } | undefined)?.value === name;
  });
  if (id === undefined) throw new Error(`${name} entity missing`);
  return id;
}

function scalarValue(value: unknown): number | string | undefined {
  if (typeof value === 'number' || typeof value === 'string') return value;
  if (value !== null && typeof value === 'object' && 'value' in value) {
    const inner = (value as { value?: unknown }).value;
    return typeof inner === 'number' || typeof inner === 'string' ? inner : undefined;
  }
  return undefined;
}

describe('readLengthScale', () => {
  it('returns 1.0 (metres) for the writer-emitted SI METRE unit assignment', async () => {
    const { model } = buildPlacedModel();
    const reader = await openReader(await bytesFor(model));
    try {
      expect(readLengthScale(reader)).toBeCloseTo(1.0, 9);
    } finally {
      reader.close();
    }
  });
});

describe('placement round-trip', () => {
  it('serializes a nested Site placement relative to its authored parent Site', async () => {
    using model = new BimModel();
    const project = unwrap(model.init({ name: 'Nested Site Project' }));
    // Author the child first: serialization must follow aggregation ownership,
    // not element insertion order, when resolving parent-relative frames.
    const bridgeSite = unwrap(
      model.addSite({
        name: 'Bridge Site',
        origin: [100, 200, 300],
        axisX: [1, 0, 0],
        axisZ: [0, 0, 1],
      })
    );
    const environment = unwrap(
      model.addSite({
        name: 'Environment Site',
        origin: [1_000, 2_000, 3_000],
        axisX: [1, 0, 0],
        axisZ: [0, 0, 1],
      })
    );
    model.aggregate(project, environment);
    model.aggregate(environment, bridgeSite);

    const reader = await openReader(await bytesFor(model));
    try {
      const bridgeSiteId = entityIdByName(reader, WebIFC.IFCSITE, 'Bridge Site');
      const placement = composeWorldPlacement(
        reader,
        objectPlacementId(reader, bridgeSiteId),
        readLengthScale(reader)
      );
      expect(placement?.origin).toEqual([1_100, 2_200, 3_300]);
    } finally {
      reader.close();
    }
  });

  it('scales nested civil placements and metre-based map coordinates through the model context', async () => {
    const fixtures = [
      { lengthUnit: 'METRE', fileUnitMetres: 1 },
      { lengthUnit: 'MILLIMETRE', fileUnitMetres: 0.001 },
    ] as const;

    for (const fixture of fixtures) {
      const reader = await openReader(await spatialContextBytes(fixture.lengthUnit));
      try {
        const environmentSiteId = entityIdByName(reader, WebIFC.IFCSITE, 'Environment site');
        const bridgeSiteId = entityIdByName(reader, WebIFC.IFCSITE, 'Bridge site');
        const bridgeId = entityIdByName(reader, WebIFC.IFCBRIDGE, 'Context bridge');
        const partId = entityIdByName(reader, WebIFC.IFCBRIDGEPART, 'Context part');
        const environmentSite = composeWorldPlacement(
          reader,
          objectPlacementId(reader, environmentSiteId),
          fixture.fileUnitMetres
        );
        const bridgeSite = composeWorldPlacement(
          reader,
          objectPlacementId(reader, bridgeSiteId),
          fixture.fileUnitMetres
        );
        const bridge = composeWorldPlacement(
          reader,
          objectPlacementId(reader, bridgeId),
          fixture.fileUnitMetres
        );
        const part = composeWorldPlacement(
          reader,
          objectPlacementId(reader, partId),
          fixture.fileUnitMetres
        );
        expect(environmentSite?.origin).toEqual([1_000, 2_000, 3_000]);
        expect(bridgeSite?.origin).toEqual([1_100, 2_200, 3_300]);
        expect(bridge?.origin).toEqual([5_100, 7_200, 9_300]);
        expect(part?.origin).toEqual([12_100, 15_200, 18_300]);

        const georef = readGeoref(reader, fixture.fileUnitMetres);
        expect(georef).toMatchObject({
          eastings: 17_250,
          northings: 30_500,
          orthogonalHeight: 2_250,
        });
        expect(georef?.rotation).toBeCloseTo(-Math.PI / 3, 10);
      } finally {
        reader.close();
      }
    }
  });

  it('projects a synthetic Bridge with genuine millimetre units and exactly-once map conversion', async () => {
    using model = new BimModel();
    const project = unwrap(
      model.init({
        name: 'Millimetre Bridge Project',
        projectId: 'millimetre-bridge-project',
        crs: {
          name: 'EPSG:9999',
          verticalDatum: 'TEST-VERTICAL-DATUM',
          eastingMm: 17_320_508,
          northingMm: 30_000_000,
          elevationMm: 242_321,
          xAxisBearingDeg: 120,
        },
      })
    );
    const site = unwrap(
      model.addSite({
        name: 'Bridge Site',
        origin: [1_000, 0, 0],
        axisX: [1, 0, 0],
        axisZ: [0, 0, 1],
      })
    );
    const bridge = unwrap(
      model.addBridge({
        name: 'Synthetic Bridge',
        origin: [2_000, 0, 0],
        axisX: [1, 0, 0],
        axisZ: [0, 0, 1],
      })
    );
    const part = unwrap(
      model.addBridgePart({
        name: 'Synthetic Superstructure',
        origin: [3_000, 0, 0],
        axisX: [1, 0, 0],
        axisZ: [0, 0, 1],
        usageType: 'LONGITUDINAL',
      })
    );
    const member = unwrap(
      model.addMember({
        name: 'Synthetic Girder',
        length: 1_000,
        profile: { kind: 'RECTANGULAR', width: 100, height: 200 },
        origin: [4_000, 0, 0],
        axisX: [1, 0, 0],
        axisZ: [0, 0, 1],
        materialName: 'Steel',
      })
    );
    model.aggregate(project, site);
    model.aggregate(site, bridge);
    model.aggregate(bridge, part);
    model.placeIn(member, part);

    const result = await toIfc(model, {
      applicationName: 'millimetre-bridge-fixture',
      applicationVersion: '1',
      ifcSchema: 'IFC4X3',
      mvdViewDefinition: 'ReferenceView_v1.2',
      ifcLengthUnit: 'MILLIMETRE',
    });
    if (!result.ok) throw new Error(result.error.message);

    const reader = await openReader(result.value);
    try {
      expect(readLengthScale(reader)).toBe(0.001);
      const siUnits = reader
        .getLinesOfType(WebIFC.IFCSIUNIT)
        .map((id) => reader.getLine<Record<string, unknown>>(id));
      for (const unitType of ['LENGTHUNIT', 'AREAUNIT', 'VOLUMEUNIT']) {
        const unit = siUnits.find((candidate) => scalarValue(candidate?.['UnitType']) === unitType);
        expect(scalarValue(unit?.['Prefix'])).toBe('MILLI');
      }
      expect(reader.getLinesOfType(WebIFC.IFCMAPCONVERSION)).toHaveLength(1);
      const georef = readGeoref(reader, readLengthScale(reader));
      expect(georef).toMatchObject({
        eastings: 17_320_508,
        northings: 30_000_000,
        orthogonalHeight: 242_321,
        crsName: 'EPSG:9999',
        verticalDatum: 'TEST-VERTICAL-DATUM',
        scale: 1,
        mapUnitScale: 0.001,
      });
      expect(georef?.xAxisAbscissa).toBeCloseTo(Math.sin((120 * Math.PI) / 180), 12);
      expect(georef?.xAxisOrdinate).toBeCloseTo(Math.cos((120 * Math.PI) / 180), 12);

      const memberId = entityIdByName(reader, WebIFC.IFCMEMBER, 'Synthetic Girder');
      const world = composeWorldPlacement(
        reader,
        objectPlacementId(reader, memberId),
        readLengthScale(reader)
      );
      expect(world?.origin).toEqual([10_000, 0, 0]);

      const profileId = reader.getLinesOfType(WebIFC.IFCRECTANGLEPROFILEDEF)[0];
      const extrusionId = reader.getLinesOfType(WebIFC.IFCEXTRUDEDAREASOLID)[0];
      if (profileId === undefined || extrusionId === undefined) throw new Error('geometry missing');
      const profile = reader.getLine<Record<string, unknown>>(profileId);
      const extrusion = reader.getLine<Record<string, unknown>>(extrusionId);
      expect(scalarValue(profile?.['XDim'])).toBe(100);
      expect(scalarValue(profile?.['YDim'])).toBe(200);
      expect(scalarValue(extrusion?.['Depth'])).toBe(1_000);
    } finally {
      reader.close();
    }
  });

  it('recovers the wall world origin (storey elevation + relative origin) in mm', async () => {
    const placed = buildPlacedModel();
    const reader = await openReader(await bytesFor(placed.model));
    try {
      reader.buildGuidMap();
      const wallId = reader.expressIdFromGuid(placed.wallGuid);
      expect(wallId).toBeDefined();
      if (wallId === undefined) return;

      const scale = readLengthScale(reader);
      const placementId = objectPlacementId(reader, wallId);
      const world = composeWorldPlacement(reader, placementId, scale);
      expect(world).not.toBeNull();
      if (world === null) return;

      // World origin = wall relative origin + storey elevation in Z, all in mm.
      expect(world.origin[0]).toBeCloseTo(placed.origin[0], 4);
      expect(world.origin[1]).toBeCloseTo(placed.origin[1], 4);
      expect(world.origin[2]).toBeCloseTo(placed.origin[2] + placed.storeyElevation, 4);
    } finally {
      reader.close();
    }
  });

  it('recovers the wall axes (local X along world +Y, Z up)', async () => {
    const placed = buildPlacedModel();
    const reader = await openReader(await bytesFor(placed.model));
    try {
      reader.buildGuidMap();
      const wallId = reader.expressIdFromGuid(placed.wallGuid);
      if (wallId === undefined) throw new Error('wall id missing');

      const scale = readLengthScale(reader);
      const placementId = objectPlacementId(reader, wallId);
      const world = composeWorldPlacement(reader, placementId, scale);
      if (world === null) throw new Error('world placement null');

      expect(world.axisX[0]).toBeCloseTo(0, 6);
      expect(world.axisX[1]).toBeCloseTo(1, 6);
      expect(world.axisX[2]).toBeCloseTo(0, 6);

      expect(world.axisZ[0]).toBeCloseTo(0, 6);
      expect(world.axisZ[1]).toBeCloseTo(0, 6);
      expect(world.axisZ[2]).toBeCloseTo(1, 6);
    } finally {
      reader.close();
    }
  });

  it('composeWorldMatrix and decomposePlacement agree with composeWorldPlacement', async () => {
    const placed = buildPlacedModel();
    const reader = await openReader(await bytesFor(placed.model));
    try {
      reader.buildGuidMap();
      const wallId = reader.expressIdFromGuid(placed.wallGuid);
      if (wallId === undefined) throw new Error('wall id missing');

      const scale = readLengthScale(reader);
      const placementId = objectPlacementId(reader, wallId);
      const matrix = composeWorldMatrix(reader, placementId, scale);
      expect(matrix).not.toBeNull();
      if (matrix === null) return;

      const decomposed = decomposePlacement(matrix);
      const direct = composeWorldPlacement(reader, placementId, scale);
      if (direct === null) throw new Error('direct placement null');

      for (let i = 0; i < 3; i++) {
        expect(decomposed.origin[i]).toBeCloseTo(direct.origin[i], 4);
        expect(decomposed.axisX[i]).toBeCloseTo(direct.axisX[i], 6);
        expect(decomposed.axisZ[i]).toBeCloseTo(direct.axisZ[i], 6);
      }
    } finally {
      reader.close();
    }
  });

  it('returns the identity-equivalent placement for an unrotated element at storey origin', async () => {
    const model = new BimModel();
    const initResult = model.init({ name: 'Origin Project' });
    if (!initResult.ok) throw new Error(initResult.error.message);
    const projectId = initResult.value;
    const siteId = unwrap(model.addSite({ name: 'Site' }));
    const buildingId = unwrap(model.addBuilding({ name: 'Building' }));
    const storeyId = unwrap(model.addStorey({ name: 'L0', elevation: 0 }));
    model.aggregate(projectId, siteId);
    model.aggregate(siteId, buildingId);
    model.aggregate(buildingId, storeyId);
    const wall = model.addWall({
      length: 5000,
      height: 3000,
      thickness: 200,
      origin: [0, 0, 0],
      axisX: [1, 0, 0],
      axisZ: [0, 0, 1],
      materialName: 'Concrete',
    });
    if (!wall.ok) throw new Error(wall.error.message);
    model.placeIn(wall.value, storeyId);
    const guid = model.getWalls()[0]?.guid;
    if (guid === undefined) throw new Error('guid missing');

    const reader = await openReader(await bytesFor(model));
    try {
      reader.buildGuidMap();
      const wallId = reader.expressIdFromGuid(guid);
      if (wallId === undefined) throw new Error('wall id missing');
      const scale = readLengthScale(reader);
      const matrix = composeWorldMatrix(reader, objectPlacementId(reader, wallId), scale);
      if (matrix === null) throw new Error('matrix null');
      const id = identityMatrix();
      for (let i = 0; i < 16; i++) {
        expect(matrix[i]).toBeCloseTo(id[i] ?? 0, 6);
      }
    } finally {
      reader.close();
    }
  });
});

describe('readGeoref', () => {
  it('returns null when no IfcMapConversion/IfcProjectedCRS is present', async () => {
    const { model } = buildPlacedModel();
    const reader = await openReader(await bytesFor(model));
    try {
      expect(reader.getLinesOfType(WebIFC.IFCMAPCONVERSION).length).toBe(0);
      expect(readGeoref(reader, readLengthScale(reader))).toBeNull();
    } finally {
      reader.close();
    }
  });
});
