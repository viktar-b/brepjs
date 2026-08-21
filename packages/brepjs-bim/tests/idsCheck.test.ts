import { unwrap } from 'brepjs';
import { createHash } from 'node:crypto';
import { describe, it, expect, beforeAll } from 'vitest';
import { initOCCT } from '../../../tests/setup.js';
import { BimModel } from '../src/model/bimModel.js';
import { toIfc } from '../src/serialize/toIfc.js';
import { parseIdsXml } from '../src/ids/idsParser.js';
import { checkIdsData } from '../src/ids/idsEngine.js';
import {
  BRIDGE_BASELINE_IDS_SHA256,
  BRIDGE_BASELINE_IDS_XML,
  BRIDGE_VALIDATION_GATES,
  buildBridgeValidationReport,
  evaluateBridgeIds,
  type BridgeGateResultInput,
} from '../src/index.js';

beforeAll(async () => {
  await initOCCT();
}, 30000);

const META = { applicationName: 'brepjs-bim', applicationVersion: '0.1.0' };

/**
 * IDS requiring every IfcWall to carry Pset_WallCommon.IsExternal. Applicability
 * is the Entity facet (IFCWALL); the single requirement is the Property facet.
 */
const WALL_IS_EXTERNAL_IDS = `<?xml version="1.0" encoding="UTF-8"?>
<ids xmlns="http://standards.buildingsmart.org/IDS">
  <info>
    <title>Wall IsExternal requirement</title>
  </info>
  <specifications>
    <specification name="Walls must declare IsExternal" ifcVersion="IFC4">
      <applicability minOccurs="1" maxOccurs="unbounded">
        <entity>
          <name>
            <simpleValue>IFCWALL</simpleValue>
          </name>
        </entity>
      </applicability>
      <requirements>
        <property>
          <propertySet>
            <simpleValue>Pset_WallCommon</simpleValue>
          </propertySet>
          <baseName>
            <simpleValue>IsExternal</simpleValue>
          </baseName>
        </property>
      </requirements>
    </specification>
  </specifications>
</ids>`;

const WALL_PARTOF_IDS = `<?xml version="1.0" encoding="UTF-8"?>
<ids xmlns="http://standards.buildingsmart.org/IDS">
  <info>
    <title>Walls must be spatially contained</title>
  </info>
  <specifications>
    <specification name="Wall containment" ifcVersion="IFC4">
      <applicability minOccurs="1" maxOccurs="unbounded">
        <entity>
          <name>
            <simpleValue>IFCWALL</simpleValue>
          </name>
        </entity>
      </applicability>
      <requirements>
        <partOf relation="IFCRELCONTAINEDINSPATIALSTRUCTURE">
          <entity>
            <name>
              <simpleValue>IFCBUILDINGSTOREY</simpleValue>
            </name>
          </entity>
        </partOf>
      </requirements>
    </specification>
  </specifications>
</ids>`;

const PROJECT_BRIDGE_NAME_IDS = `<?xml version="1.0" encoding="UTF-8"?>
<ids xmlns="http://standards.buildingsmart.org/IDS">
  <info>
    <title>Project Bridge naming requirement</title>
  </info>
  <specifications>
    <specification name="Bridge uses the project-approved name" ifcVersion="IFC4X3_ADD2">
      <applicability minOccurs="1" maxOccurs="unbounded">
        <entity>
          <name><simpleValue>IFCBRIDGE</simpleValue></name>
        </entity>
      </applicability>
      <requirements>
        <attribute cardinality="required">
          <name><simpleValue>Name</simpleValue></name>
          <value><simpleValue>Accepted Bridge</simpleValue></value>
        </attribute>
      </requirements>
    </specification>
  </specifications>
</ids>`;

/** Builds a minimal spatial tree plus one wall, optionally marking it external. */
function buildWallModel(withIsExternal: boolean): BimModel {
  const model = new BimModel();
  const initResult = model.init({ name: 'IDS Project' });
  if (!initResult.ok) throw new Error(initResult.error.message);
  const projectId = initResult.value;
  const siteId = unwrap(model.addSite({ name: 'Site' }));
  const buildingId = unwrap(model.addBuilding({ name: 'Building' }));
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
    // isExternal drives Pset_WallCommon.IsExternal; omitting it yields a wall
    // with no IsExternal property, which the IDS requirement must flag.
    ...(withIsExternal ? { isExternal: true } : {}),
  });
  if (!wall.ok) throw new Error(wall.error.message);
  model.placeIn(wall.value, storeyId);

  return model;
}

async function buildBridgeIfc(
  bridgeName = 'Accepted Bridge',
  includeBridgePart = true
): Promise<Uint8Array> {
  const model = new BimModel();
  const project = unwrap(
    model.init({ name: 'Bridge IDS Project', projectId: 'bridge-ids-project' })
  );
  const site = unwrap(model.addSite({ name: 'Bridge Site', compositionType: 'COMPLEX' }));
  const bridge = unwrap(
    model.addBridge({
      name: bridgeName,
      origin: [0, 0, 0],
      axisX: [1, 0, 0],
      axisZ: [0, 0, 1],
      compositionType: 'ELEMENT',
      predefinedType: 'GIRDER',
    })
  );
  model.aggregate(project, site);
  model.aggregate(site, bridge);
  if (includeBridgePart) {
    const part = unwrap(
      model.addBridgePart({
        name: 'Bridge Deck',
        origin: [0, 0, 0],
        axisX: [1, 0, 0],
        axisZ: [0, 0, 1],
        compositionType: 'ELEMENT',
        usageType: 'LATERAL',
        predefinedType: 'DECK',
      })
    );
    model.aggregate(bridge, part);
  }
  return unwrap(
    await toIfc(model, {
      ...META,
      ifcSchema: 'IFC4X3_ADD2',
      ifcLengthUnit: 'MILLIMETRE',
    })
  );
}

describe('IDS check — Pset_WallCommon.IsExternal requirement', () => {
  it('parses the IDS document into specifications with applicability and requirements', () => {
    const parsed = parseIdsXml(WALL_IS_EXTERNAL_IDS);
    if (!parsed.ok) throw new Error(parsed.error.message);
    const doc = parsed.value;

    expect(doc.title).toBe('Wall IsExternal requirement');
    expect(doc.specifications).toHaveLength(1);
    const spec = doc.specifications[0];
    expect(spec?.name).toBe('Walls must declare IsExternal');
    expect(spec?.cardinality).toBe('required');
    expect(spec?.applicability).toHaveLength(1);
    expect(spec?.applicability[0]?.kind).toBe('Entity');
    expect(spec?.requirements).toHaveLength(1);
    expect(spec?.requirements[0]?.kind).toBe('Property');
  });

  it('passes when the wall carries Pset_WallCommon.IsExternal', async () => {
    const model = buildWallModel(true);
    const bytes = await toIfc(model, META);
    if (!bytes.ok) throw new Error(bytes.error.message);

    const parsed = parseIdsXml(WALL_IS_EXTERNAL_IDS);
    if (!parsed.ok) throw new Error(parsed.error.message);

    const report = unwrap(await checkIdsData(bytes.value, parsed.value));
    expect(report.pass).toBe(true);
    expect(report.results).toHaveLength(1);
    const result = report.results[0];
    expect(result?.specificationName).toBe('Walls must declare IsExternal');
    expect(result?.pass).toBe(true);
    expect(result?.applicableCount).toBe(1);
    expect(result?.passedCount).toBe(1);
    expect(result?.issues.filter((i) => i.severity === 'error')).toHaveLength(0);
  });

  it('fails when the wall is missing the required property', async () => {
    const model = buildWallModel(false);
    const bytes = await toIfc(model, META);
    if (!bytes.ok) throw new Error(bytes.error.message);

    const parsed = parseIdsXml(WALL_IS_EXTERNAL_IDS);
    if (!parsed.ok) throw new Error(parsed.error.message);

    const report = unwrap(await checkIdsData(bytes.value, parsed.value));
    expect(report.pass).toBe(false);
    const result = report.results[0];
    expect(result?.pass).toBe(false);
    expect(result?.applicableCount).toBe(1);
    expect(result?.failedCount).toBe(1);
    const errors = result?.issues.filter((i) => i.severity === 'error') ?? [];
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]?.code).toBe('IDS_REQUIREMENT_FAILED');
  });

  it('evaluates PartOf: a contained wall passes a containment requirement', async () => {
    const model = buildWallModel(true);
    const bytes = await toIfc(model, META);
    if (!bytes.ok) throw new Error(bytes.error.message);
    const parsed = parseIdsXml(WALL_PARTOF_IDS);
    if (!parsed.ok) throw new Error(parsed.error.message);
    const report = unwrap(await checkIdsData(bytes.value, parsed.value));
    expect(report.pass).toBe(true);
    expect(report.unsupportedFacets).toEqual([]);
  });

  it('rejects an audit-invalid document (unknown entity class)', () => {
    const parsed = parseIdsXml(WALL_IS_EXTERNAL_IDS.replace(/IFCWALL/g, 'IFCWALDO'));
    expect(parsed.ok).toBe(false);
  });
});

describe('bim/bridge/v1 baseline and project IDS', () => {
  it('evaluates the immutable baseline and stronger project IDS as separate ordered gates', async () => {
    const ifcBytes = await buildBridgeIfc();
    const evaluation = unwrap(
      await evaluateBridgeIds({
        ifcBytes,
        baselineIdsXml: BRIDGE_BASELINE_IDS_XML,
        projectIdsXml: PROJECT_BRIDGE_NAME_IDS,
      })
    );

    expect(BRIDGE_BASELINE_IDS_SHA256).toBe(
      createHash('sha256').update(BRIDGE_BASELINE_IDS_XML).digest('hex')
    );
    expect(evaluation.validator).toEqual({
      id: 'brepjs-bim.ids',
      name: 'brepjs-bim IDS 1.0 checker',
      version: '1',
    });
    expect(evaluation.gateResults.map((gate) => gate.gateId)).toEqual([
      'ids.baseline',
      'ids.project',
    ]);
    expect(evaluation.gateResults.map((gate) => gate.status)).toEqual(['pass', 'pass']);
    expect(evaluation.gateResults[0]?.evidence).toContainEqual({
      kind: 'ids-document',
      value: 'requirements/bim-bridge-v1.ids',
      checksum: BRIDGE_BASELINE_IDS_SHA256,
    });
    expect(evaluation.gateResults[1]?.evidence[0]?.checksum).toMatch(/^[0-9a-f]{64}$/);

    const idsByGate = new Map(evaluation.gateResults.map((gate) => [gate.gateId, gate]));
    const reportResults: BridgeGateResultInput[] = BRIDGE_VALIDATION_GATES.filter(
      (gate) => gate.required
    ).map(
      (gate) =>
        idsByGate.get(gate.id) ?? {
          gateId: gate.id,
          status: 'pass',
          validatorId: 'brepjs-bim.ids',
          issues: [],
          evidence: [{ kind: 'model', value: gate.id }],
        }
    );
    const report = unwrap(
      buildBridgeValidationReport({
        ifcSchema: 'IFC4X3_ADD2',
        ifcView: 'ReferenceView',
        modelHash: { algorithm: 'sha256', value: 'a'.repeat(64) },
        validators: [evaluation.validator],
        gateResults: reportResults,
      })
    );
    expect(report.gates.filter((gate) => gate.id.startsWith('ids.'))).toMatchObject([
      { id: 'ids.baseline', required: true, status: 'pass' },
      { id: 'ids.project', required: true, status: 'pass' },
    ]);
  });

  it('fails a modified baseline while still evaluating the separate project requirements', async () => {
    const ifcBytes = await buildBridgeIfc();
    const evaluation = unwrap(
      await evaluateBridgeIds({
        ifcBytes,
        baselineIdsXml: BRIDGE_BASELINE_IDS_XML.replace('At least one Site', 'A modified Site'),
        projectIdsXml: PROJECT_BRIDGE_NAME_IDS,
      })
    );

    expect(evaluation.gateResults[0]).toMatchObject({
      gateId: 'ids.baseline',
      status: 'fail',
      validatorId: 'brepjs-bim.ids',
      issues: [{ code: 'BRIDGE_BASELINE_IDS_CHECKSUM_MISMATCH' }],
    });
    expect(evaluation.gateResults[1]).toMatchObject({
      gateId: 'ids.project',
      status: 'pass',
    });
  });

  it('fails an unchanged baseline requirement without replacing the separate project result', async () => {
    const ifcBytes = await buildBridgeIfc('Accepted Bridge', false);
    const evaluation = unwrap(
      await evaluateBridgeIds({
        ifcBytes,
        baselineIdsXml: BRIDGE_BASELINE_IDS_XML,
        projectIdsXml: PROJECT_BRIDGE_NAME_IDS,
      })
    );

    expect(evaluation.gateResults[0]).toMatchObject({
      gateId: 'ids.baseline',
      status: 'fail',
      issues: [{ code: 'IDS_NOTHING_APPLICABLE' }],
    });
    expect(evaluation.gateResults[1]).toMatchObject({
      gateId: 'ids.project',
      status: 'pass',
    });
  });

  it('keeps a stronger failing project IDS separate from the passing baseline', async () => {
    const ifcBytes = await buildBridgeIfc('Unapproved Bridge');
    const evaluation = unwrap(
      await evaluateBridgeIds({
        ifcBytes,
        baselineIdsXml: BRIDGE_BASELINE_IDS_XML,
        projectIdsXml: PROJECT_BRIDGE_NAME_IDS,
      })
    );

    expect(evaluation.gateResults[0]?.status).toBe('pass');
    expect(evaluation.gateResults[1]).toMatchObject({
      gateId: 'ids.project',
      status: 'fail',
      issues: [{ code: 'IDS_REQUIREMENT_FAILED' }],
    });
  });

  it('reports missing or crashed required IDS evidence as unavailable, never pass', async () => {
    const ifcBytes = await buildBridgeIfc();
    const missing = unwrap(
      await evaluateBridgeIds({
        ifcBytes,
        baselineIdsXml: null,
        projectIdsXml: null,
      })
    );
    expect(missing.gateResults).toMatchObject([
      { gateId: 'ids.baseline', status: 'unavailable', unavailableReason: 'missing' },
      { gateId: 'ids.project', status: 'unavailable', unavailableReason: 'missing' },
    ]);

    const crashed = unwrap(
      await evaluateBridgeIds({
        ifcBytes: new Uint8Array([1, 2, 3]),
        baselineIdsXml: BRIDGE_BASELINE_IDS_XML,
        projectIdsXml: PROJECT_BRIDGE_NAME_IDS,
      })
    );
    expect(crashed.gateResults).toMatchObject([
      { gateId: 'ids.baseline', status: 'unavailable', unavailableReason: 'crashed' },
      { gateId: 'ids.project', status: 'unavailable', unavailableReason: 'crashed' },
    ]);
  });
});
