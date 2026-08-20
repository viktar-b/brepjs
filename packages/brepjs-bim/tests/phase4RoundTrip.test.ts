import { describe, it, expect, beforeAll } from 'vitest';
import { measureVolume, unwrap } from 'brepjs';
import { initOCCT } from '../../../tests/setup.js';
import { BimModel } from '../src/model/bimModel.js';
import { toIfc } from '../src/serialize/toIfc.js';
import { fromIfc } from '../src/import/fromIfc.js';
import {
  checkRoundTrip,
  compareCounts,
  compareIfcObservations,
  type RoundTripPass,
} from '../src/validation/roundTrip.js';

beforeAll(async () => {
  await initOCCT();
}, 30000);

const META = { applicationName: 'brepjs-bim', applicationVersion: '0.1.0' };

function buildNestedBridgeModel(): BimModel {
  const model = new BimModel();
  const project = unwrap(
    model.init({
      name: 'Relationship-aware Bridge',
      projectId: 'relationship-aware-bridge',
      crs: {
        name: 'EPSG:9999',
        description: 'Synthetic projected bridge CRS',
        geodeticDatum: 'TEST-GEODETIC-DATUM',
        verticalDatum: 'TEST-VERTICAL-DATUM',
        mapProjection: 'TEST-PROJECTION',
        mapZone: 'TEST-ZONE',
        eastingMm: 17_320_508,
        northingMm: 30_000_000,
        elevationMm: 242_321,
        xAxisBearingDeg: 120,
      },
    })
  );
  const region = unwrap(
    model.addSite({
      name: 'Region',
      origin: [100, 200, 300],
      axisX: [0, 1, 0],
      axisZ: [0, 0, 1],
      compositionType: 'COMPLEX',
    })
  );
  const site = unwrap(
    model.addSite({
      name: 'Bridge Site',
      origin: [1_000, 2_000, 3_000],
      axisX: [0, -1, 0],
      axisZ: [0, 0, 1],
      compositionType: 'ELEMENT',
    })
  );
  const bridge = unwrap(
    model.addBridge({
      name: 'Bridge Facility',
      origin: [4_000, 5_000, 6_000],
      axisX: [1, 0, 0],
      axisZ: [0, 0, 1],
      compositionType: 'ELEMENT',
    })
  );
  const superstructure = unwrap(
    model.addBridgePart({
      name: 'Superstructure',
      origin: [7_000, 8_000, 9_000],
      axisX: [0, 1, 0],
      axisZ: [0, 0, 1],
      compositionType: 'COMPLEX',
      usageType: 'LONGITUDINAL',
    })
  );
  const lateral = unwrap(
    model.addBridgePart({
      name: 'Left Deck',
      origin: [10_000, 11_000, 12_000],
      axisX: [-1, 0, 0],
      axisZ: [0, 0, 1],
      compositionType: 'PARTIAL',
      usageType: 'LATERAL',
    })
  );
  const member = unwrap(
    model.addMember({
      name: 'Left Girder',
      length: 1_000,
      profile: { kind: 'RECTANGULAR', width: 100, height: 200 },
      origin: [13_000, 14_000, 15_000],
      axisX: [0, 1, 0],
      axisZ: [0, 0, 1],
      materialName: 'Steel',
    })
  );
  const bearing = unwrap(
    model.addMember({
      name: 'Right Bearing',
      length: 250,
      profile: { kind: 'RECTANGULAR', width: 300, height: 150 },
      origin: [16_000, 17_000, 18_000],
      axisX: [1, 0, 0],
      axisZ: [0, 1, 0],
      materialName: 'Steel',
    })
  );
  model.aggregate(project, region);
  model.aggregate(region, site);
  model.aggregate(site, bridge);
  model.aggregate(bridge, superstructure);
  model.aggregate(superstructure, lateral);
  model.placeIn(member, lateral);
  model.placeIn(bearing, superstructure);
  return model;
}

interface BuiltModel {
  readonly model: BimModel;
}

/**
 * Builds a representative model: project/site/building/storey + a wall (with a
 * custom Pset), a slab, a circular column, and a door cut into the wall.
 */
function buildRoundTripModel(): BuiltModel {
  const model = new BimModel();
  const initResult = model.init({ name: 'RoundTrip Project' });
  if (!initResult.ok) throw new Error(initResult.error.message);
  const projectId = initResult.value;
  const siteId = unwrap(model.addSite({ name: 'Site A' }));
  const buildingId = unwrap(model.addBuilding({ name: 'Building A' }));
  const storeyId = unwrap(model.addStorey({ name: 'Level 1', elevation: 0 }));
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
    isExternal: true,
    customProperties: {
      Pset_Custom: { LoadRating: 42, Tag: 'W-01', Approved: true },
    },
  });
  if (!wall.ok) throw new Error(wall.error.message);
  model.placeIn(wall.value, storeyId);

  const slab = model.addSlab({
    length: 6000,
    width: 4000,
    thickness: 250,
    origin: [0, 0, -250],
    axisX: [1, 0, 0],
    axisZ: [0, 0, 1],
    predefinedType: 'FLOOR',
    materialName: 'Concrete',
  });
  if (!slab.ok) throw new Error(slab.error.message);
  model.placeIn(slab.value, storeyId);

  const column = model.addColumn({
    height: 3000,
    profile: { kind: 'CIRCULAR', radius: 150 },
    origin: [4500, 0, 0],
    axisX: [1, 0, 0],
    axisZ: [0, 0, 1],
    predefinedType: 'COLUMN',
    materialName: 'Steel',
  });
  if (!column.ok) throw new Error(column.error.message);
  model.placeIn(column.value, storeyId);

  const door = model.addDoor({
    wallLocalId: wall.value,
    width: 900,
    height: 2100,
    offsetAlongWall: 1000,
    offsetFromFloor: 0,
    materialName: 'Wood',
  });
  if (!door.ok) throw new Error(door.error.message);
  model.placeIn(door.value, storeyId);

  return { model };
}

describe('Phase 4 round-trip — fromIfc(toIfc(model))', () => {
  it('exposes the complete nested Bridge relationship observation contract', async () => {
    using model = buildNestedBridgeModel();
    const memberGuid = model.getMembers()[0]?.guid;
    const bytes = await toIfc(model, {
      ...META,
      ifcSchema: 'IFC4X3_ADD2',
      ifcLengthUnit: 'MILLIMETRE',
    });
    if (!bytes.ok) throw new Error(bytes.error.message);

    const imported = await fromIfc(bytes.value, { skipGeometry: true });
    if (!imported.ok) throw new Error(imported.error.message);
    const observations = imported.value.observations;

    expect(imported.value.schema).toBe('IFC4X3_ADD2');
    expect(imported.value.viewDefinition).toBe('ReferenceView');
    expect(observations.projectLengthUnit).toEqual({
      kind: 'SI',
      unitType: 'LENGTHUNIT',
      prefix: 'MILLI',
      name: 'METRE',
      metresPerUnit: 0.001,
    });
    expect(observations.mapConversionCount).toBe(1);
    expect(observations.mapConversions[0]).toMatchObject({
      eastings: 17_320_508,
      northings: 30_000_000,
      orthogonalHeight: 242_321,
      scale: 1,
      targetCrs: {
        name: 'EPSG:9999',
        description: 'Synthetic projected bridge CRS',
        geodeticDatum: 'TEST-GEODETIC-DATUM',
        verticalDatum: 'TEST-VERTICAL-DATUM',
        mapProjection: 'TEST-PROJECTION',
        mapZone: 'TEST-ZONE',
        mapUnit: {
          kind: 'SI',
          unitType: 'LENGTHUNIT',
          prefix: 'MILLI',
          name: 'METRE',
          metresPerUnit: 0.001,
        },
      },
    });
    expect(observations.decomposition).toHaveLength(5);
    expect(observations.containment).toHaveLength(2);
    expect(observations.spatialSemantics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Region', composition: 'COMPLEX' }),
        expect.objectContaining({ name: 'Bridge Site', composition: 'ELEMENT' }),
        expect.objectContaining({ name: 'Superstructure', composition: 'COMPLEX' }),
        expect.objectContaining({
          name: 'Left Deck',
          composition: 'PARTIAL',
          subdivision: 'LATERAL',
        }),
      ])
    );
    expect(observations.localPlacements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Bridge Site',
          originMm: [1_000, 2_000, 3_000],
          axisX: [0, -1, 0],
          axisZ: [0, 0, 1],
        }),
        expect.objectContaining({
          name: 'Left Girder',
          originMm: [13_000, 14_000, 15_000],
          axisX: [-1, 0, 0],
          axisZ: [0, 1, 0],
        }),
      ])
    );
    const placementByName = new Map(
      observations.localPlacements.map((placement) => [placement.name, placement])
    );
    expect(placementByName.get('Bridge Site')?.parentGuid).toBe(
      placementByName.get('Region')?.guid
    );
    expect(placementByName.get('Bridge Facility')?.parentGuid).toBe(
      placementByName.get('Bridge Site')?.guid
    );
    expect(placementByName.get('Superstructure')?.parentGuid).toBe(
      placementByName.get('Bridge Facility')?.guid
    );
    expect(placementByName.get('Left Deck')?.parentGuid).toBe(
      placementByName.get('Superstructure')?.guid
    );
    expect(placementByName.get('Left Girder')?.parentGuid).toBe(
      placementByName.get('Left Deck')?.guid
    );
    expect(observations.containment).toContain(
      `${placementByName.get('Left Deck')?.guid}>${memberGuid}`
    );
    expect(observations.globalIds).toContain(memberGuid);
  });

  it('reports a descriptive mismatch for every required Bridge observation', async () => {
    using model = buildNestedBridgeModel();
    const bytes = await toIfc(model, {
      ...META,
      ifcSchema: 'IFC4X3_ADD2',
      ifcLengthUnit: 'MILLIMETRE',
    });
    if (!bytes.ok) throw new Error(bytes.error.message);
    const roundTrip = await checkRoundTrip(bytes.value);
    expect(roundTrip.issues).toEqual([]);
    const repeated = await checkRoundTrip(bytes.value);
    expect(repeated.firstPass).toEqual(roundTrip.firstPass);
    expect(repeated.secondPass).toEqual(roundTrip.secondPass);

    const base = roundTrip.firstPass;
    const replaceFirstSpatial = (
      field: 'composition' | 'subdivision',
      value: string
    ): RoundTripPass => ({
      ...base,
      spatialSemantics: base.spatialSemantics.map((item) =>
        item.name === 'Left Deck' ? { ...item, [field]: value } : item
      ),
    });
    const replacePlacement = (
      change: Partial<RoundTripPass['localPlacements'][number]>
    ): RoundTripPass => ({
      ...base,
      localPlacements: base.localPlacements.map((item) =>
        item.name === 'Left Girder' ? { ...item, ...change } : item
      ),
    });
    const replaceCrs = (
      field:
        'name' | 'description' | 'geodeticDatum' | 'verticalDatum' | 'mapProjection' | 'mapZone',
      value: string
    ): RoundTripPass => ({
      ...base,
      mapConversions: base.mapConversions.map((conversion, index) =>
        index !== 0 || conversion.targetCrs === null
          ? conversion
          : { ...conversion, targetCrs: { ...conversion.targetCrs, [field]: value } }
      ),
    });
    const replaceMapField = (
      field:
        'eastings' | 'northings' | 'orthogonalHeight' | 'xAxisAbscissa' | 'xAxisOrdinate' | 'scale',
      value: number
    ): RoundTripPass => ({
      ...base,
      mapConversions: base.mapConversions.map((conversion, index) =>
        index === 0 ? { ...conversion, [field]: value } : conversion
      ),
    });
    expect(
      compareCounts(base, { ...base, totalCount: base.totalCount - 1 }).map((issue) => issue.code)
    ).toContain('ROUNDTRIP_TOTAL_COUNT_DELTA');
    expect(
      compareCounts(base, {
        ...base,
        typeCounts: { ...base.typeCounts, IfcBridgePart: 99 },
      }).map((issue) => issue.code)
    ).toContain('ROUNDTRIP_TYPE_COUNT_DELTA');
    const cases: ReadonlyArray<readonly [string, RoundTripPass]> = [
      ['ROUNDTRIP_GLOBAL_ID_DELTA', { ...base, globalIds: base.globalIds.slice(1) }],
      ['ROUNDTRIP_DECOMPOSITION_DELTA', { ...base, decomposition: base.decomposition.slice(1) }],
      ['ROUNDTRIP_CONTAINMENT_DELTA', { ...base, containment: [] }],
      ['ROUNDTRIP_COMPOSITION_DELTA', replaceFirstSpatial('composition', 'ELEMENT')],
      ['ROUNDTRIP_SUBDIVISION_DELTA', replaceFirstSpatial('subdivision', 'VERTICAL')],
      ['ROUNDTRIP_LOCAL_PLACEMENT_DELTA', replacePlacement({ parentGuid: null })],
      ['ROUNDTRIP_LOCAL_PLACEMENT_DELTA', replacePlacement({ originMm: [999, 998, 997] })],
      ['ROUNDTRIP_LOCAL_PLACEMENT_DELTA', replacePlacement({ axisX: [1, 0, 0] })],
      ['ROUNDTRIP_LOCAL_PLACEMENT_DELTA', replacePlacement({ axisZ: [0, 0, 1] })],
      [
        'ROUNDTRIP_PROJECT_UNIT_DELTA',
        {
          ...base,
          projectLengthUnit:
            base.projectLengthUnit === null
              ? null
              : { ...base.projectLengthUnit, prefix: null, metresPerUnit: 1 },
        },
      ],
      [
        'ROUNDTRIP_MAP_UNIT_DELTA',
        {
          ...base,
          mapConversions: base.mapConversions.map((conversion, index) =>
            index !== 0 || conversion.targetCrs === null
              ? conversion
              : {
                  ...conversion,
                  targetCrs: {
                    ...conversion.targetCrs,
                    mapUnit:
                      conversion.targetCrs.mapUnit === null
                        ? null
                        : {
                            ...conversion.targetCrs.mapUnit,
                            prefix: null,
                            metresPerUnit: 1,
                          },
                  },
                }
          ),
        },
      ],
      ['ROUNDTRIP_CRS_DELTA', replaceCrs('name', 'EPSG:0')],
      ['ROUNDTRIP_CRS_DELTA', replaceCrs('description', 'changed')],
      ['ROUNDTRIP_CRS_DELTA', replaceCrs('geodeticDatum', 'changed')],
      ['ROUNDTRIP_CRS_DELTA', replaceCrs('verticalDatum', 'changed')],
      ['ROUNDTRIP_CRS_DELTA', replaceCrs('mapProjection', 'changed')],
      ['ROUNDTRIP_CRS_DELTA', replaceCrs('mapZone', 'changed')],
      ['ROUNDTRIP_MAP_CONVERSION_COUNT_DELTA', { ...base, mapConversionCount: 0 }],
      ['ROUNDTRIP_MAP_CONVERSION_DELTA', replaceMapField('eastings', 1)],
      ['ROUNDTRIP_MAP_CONVERSION_DELTA', replaceMapField('northings', 2)],
      ['ROUNDTRIP_MAP_CONVERSION_DELTA', replaceMapField('orthogonalHeight', 3)],
      ['ROUNDTRIP_MAP_CONVERSION_DELTA', replaceMapField('xAxisAbscissa', 0)],
      ['ROUNDTRIP_MAP_CONVERSION_DELTA', replaceMapField('xAxisOrdinate', 0)],
      ['ROUNDTRIP_MAP_CONVERSION_DELTA', replaceMapField('scale', 2)],
    ];

    for (const [expectedCode, mutation] of cases) {
      const issues = compareIfcObservations(base, mutation);
      expect(
        issues.map((issue) => issue.code),
        expectedCode
      ).toContain(expectedCode);
    }

    const renamedOnly: RoundTripPass = {
      ...base,
      localPlacements: base.localPlacements.map((item, index) =>
        index === 0 ? { ...item, name: 'Display name changed' } : item
      ),
    };
    expect(compareIfcObservations(base, renamedOnly)).toEqual([]);
    expect(
      compareIfcObservations(base, { ...base, globalIds: [...base.globalIds].reverse() })
    ).toEqual([]);
  });
  it('reconstructs the spatial tree shape with preserved GlobalIds', async () => {
    const { model } = buildRoundTripModel();
    const bytes = await toIfc(model, META);
    if (!bytes.ok) throw new Error(bytes.error.message);

    const imported = await fromIfc(bytes.value);
    if (!imported.ok) throw new Error(imported.error.message);
    const m = imported.value;

    expect(m.schema).toBe('IFC4');
    const tree = m.spatialTree;
    expect(tree).not.toBeNull();
    expect(tree?.category).toBe('PROJECT');
    expect(tree?.guid).toBe(model.getProject()?.guid);

    const site = tree?.children[0];
    expect(site?.category).toBe('SITE');
    const building = site?.children[0];
    expect(building?.category).toBe('BUILDING');
    const storey = building?.children[0];
    expect(storey?.category).toBe('STOREY');
    expect(storey?.elevationMm).toBe(0);
  });

  it('preserves element count and categories', async () => {
    const { model } = buildRoundTripModel();
    const bytes = await toIfc(model, META);
    if (!bytes.ok) throw new Error(bytes.error.message);

    const imported = await fromIfc(bytes.value);
    if (!imported.ok) throw new Error(imported.error.message);
    const cats = imported.value.elements.map((e) => e.category).sort();

    // wall + slab + column + opening + door = 5 physical elements.
    expect(cats).toContain('WALL');
    expect(cats).toContain('SLAB');
    expect(cats).toContain('COLUMN');
    expect(cats).toContain('DOOR');
    expect(cats).toContain('OPENING');
    expect(imported.value.elements.length).toBe(5);
  });

  it('preserves GlobalIds byte-for-byte', async () => {
    const { model } = buildRoundTripModel();
    const bytes = await toIfc(model, META);
    if (!bytes.ok) throw new Error(bytes.error.message);

    const imported = await fromIfc(bytes.value);
    if (!imported.ok) throw new Error(imported.error.message);

    const wallGuid = model.getWalls()[0]?.guid;
    const slabGuid = model.getSlabs()[0]?.guid;
    const columnGuid = model.getColumns()[0]?.guid;
    const doorGuid = model.getDoors()[0]?.guid;

    const importedWall = imported.value.elements.find((e) => e.category === 'WALL');
    const importedSlab = imported.value.elements.find((e) => e.category === 'SLAB');
    const importedColumn = imported.value.elements.find((e) => e.category === 'COLUMN');
    const importedDoor = imported.value.elements.find((e) => e.category === 'DOOR');

    expect(importedWall?.guid).toBe(wallGuid);
    expect(importedSlab?.guid).toBe(slabGuid);
    expect(importedColumn?.guid).toBe(columnGuid);
    expect(importedDoor?.guid).toBe(doorGuid);
  });

  it('reconstructs the slab solid with PARAMETRIC fidelity and exact volume', async () => {
    const { model } = buildRoundTripModel();
    const bytes = await toIfc(model, META);
    if (!bytes.ok) throw new Error(bytes.error.message);

    const imported = await fromIfc(bytes.value);
    if (!imported.ok) throw new Error(imported.error.message);

    const slab = imported.value.elements.find((e) => e.category === 'SLAB');
    expect(slab?.geometry.fidelity).toBe('PARAMETRIC');
    const solid = slab?.geometry.solid;
    if (solid === null || solid === undefined) throw new Error('slab solid missing');
    const vol = measureVolume(solid);
    if (!vol.ok) throw new Error(vol.error.message);
    // Clean rectangular extrusion, no voids → reconstructs losslessly.
    expect(vol.value).toBeCloseTo(6000 * 4000 * 250, 0);
  });

  it('subtracts the door void from the reconstructed wall (PARAMETRIC)', async () => {
    const { model } = buildRoundTripModel();
    const bytes = await toIfc(model, META);
    if (!bytes.ok) throw new Error(bytes.error.message);

    const imported = await fromIfc(bytes.value);
    if (!imported.ok) throw new Error(imported.error.message);

    const wall = imported.value.elements.find((e) => e.category === 'WALL');
    expect(wall?.geometry.fidelity).toBe('PARAMETRIC');
    const solid = wall?.geometry.solid;
    if (solid === null || solid === undefined) throw new Error('wall solid missing');
    const vol = measureVolume(solid);
    if (!vol.ok) throw new Error(vol.error.message);
    // The full wall body extrusion is 5000×3000×200 = 3e9 mm³; the door void
    // (per IfcRelVoidsElement) removes material, so the reconstructed cut wall
    // must be strictly smaller than the uncut body.
    const uncutBody = 5000 * 3000 * 200;
    expect(vol.value).toBeLessThan(uncutBody);
    expect(vol.value).toBeGreaterThan(uncutBody * 0.8);
  });

  it('reads back Pset values and material', async () => {
    const { model } = buildRoundTripModel();
    const bytes = await toIfc(model, META);
    if (!bytes.ok) throw new Error(bytes.error.message);

    const imported = await fromIfc(bytes.value);
    if (!imported.ok) throw new Error(imported.error.message);

    const wall = imported.value.elements.find((e) => e.category === 'WALL');
    expect(wall?.psets.length).toBeGreaterThan(0);
    const custom = wall?.psets.find((p) => p.name === 'Pset_Custom');
    expect(custom).toBeDefined();
    expect(custom?.properties['LoadRating']).toBe(42);
    expect(custom?.properties['Tag']).toBe('W-01');
    expect(custom?.properties['Approved']).toBe(true);
    // measure-type codes are exposed per property (round-6 fix).
    expect(Object.keys(custom?.measureTypes ?? {}).length).toBeGreaterThan(0);
    expect(wall?.material?.name).toBe('Concrete');
  });

  it('reads back the door→opening void/fill relation', async () => {
    const { model } = buildRoundTripModel();
    const bytes = await toIfc(model, META);
    if (!bytes.ok) throw new Error(bytes.error.message);

    const imported = await fromIfc(bytes.value);
    if (!imported.ok) throw new Error(imported.error.message);

    const wall = imported.value.elements.find((e) => e.category === 'WALL');
    const door = imported.value.elements.find((e) => e.category === 'DOOR');
    const opening = imported.value.elements.find((e) => e.category === 'OPENING');
    expect(wall?.voidedBy.length).toBe(1);
    expect(opening).toBeDefined();
    expect(wall?.voidedBy[0]).toBe(opening?.expressId);
    expect(door?.fills).toBe(opening?.expressId);
  });

  it('produces no error-severity diagnostics for a clean round-trip', async () => {
    const { model } = buildRoundTripModel();
    const bytes = await toIfc(model, META);
    if (!bytes.ok) throw new Error(bytes.error.message);

    const imported = await fromIfc(bytes.value);
    if (!imported.ok) throw new Error(imported.error.message);

    const errors = imported.value.diagnostics.issues.filter((i) => i.severity === 'error');
    expect(errors).toHaveLength(0);
  });

  it('exposes a byExpressId lookup map consistent with the element list', async () => {
    const { model } = buildRoundTripModel();
    const bytes = await toIfc(model, META);
    if (!bytes.ok) throw new Error(bytes.error.message);

    const imported = await fromIfc(bytes.value);
    if (!imported.ok) throw new Error(imported.error.message);
    const m = imported.value;

    expect(m.byExpressId.size).toBe(m.elements.length);
    for (const el of m.elements) {
      expect(m.byExpressId.get(el.expressId)).toBe(el);
    }
  });
});
