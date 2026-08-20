import { describe, it, expect, beforeAll } from 'vitest';
import { createHash } from 'node:crypto';
import { initOCCT } from '../../../tests/setup.js';
import { IfcWriter } from '../src/ifc-writer/ifcWriter.js';
import { writeHeader } from '../src/ifc-writer/headerWriter.js';
import {
  createIfcSerializationContext,
  type IfcLengthUnit,
} from '../src/ifc-writer/serializationContext.js';
import { unwrap } from 'brepjs';
import { BimModel } from '../src/model/bimModel.js';
import { toIfc } from '../src/serialize/toIfc.js';

beforeAll(async () => {
  await initOCCT();
}, 30000);

/** Serializes an empty model and returns its STEP header region as text. */
async function headerText(header: { author?: string; organization?: string }): Promise<string> {
  const created = await IfcWriter.create('CoordinationView', 'IFC4', header);
  if (!created.ok) throw new Error(created.error.message);
  const saved = created.value.save();
  if (!saved.ok) throw new Error(saved.error.message);
  return new TextDecoder().decode(saved.value.subarray(0, 1024));
}

async function serializedUnitFixture(lengthUnit?: IfcLengthUnit): Promise<{
  readonly bytes: Uint8Array;
  readonly writerLengthUnit: IfcLengthUnit;
}> {
  const created = await IfcWriter.create('ReferenceView_v1.2', 'IFC4', {}, lengthUnit);
  if (!created.ok) throw new Error(created.error.message);
  const writerLengthUnit = created.value.serializationContext.lengthUnit;
  writeHeader(created.value, {
    applicationName: 'unit-context-fixture',
    applicationVersion: '1',
  });
  const saved = created.value.save();
  if (!saved.ok) throw new Error(saved.error.message);
  return { bytes: saved.value, writerLengthUnit };
}

function buildUnitParityModel(): BimModel {
  const model = new BimModel();
  const project = unwrap(
    model.init({ name: 'Unit parity project', projectId: 'unit-parity-project' })
  );
  const site = unwrap(model.addSite({ name: 'Unit parity site' }));
  const building = unwrap(model.addBuilding({ name: 'Unit parity building' }));
  const storey = unwrap(model.addStorey({ name: 'Ground', elevation: 0 }));
  model.aggregate(project, site);
  model.aggregate(site, building);
  model.aggregate(building, storey);
  return model;
}

function stableIfcBytes(bytes: Uint8Array): Uint8Array {
  const text = new TextDecoder().decode(bytes);
  return new TextEncoder().encode(
    text.replace(/FILE_NAME\('[^']*','[^']*'/, "FILE_NAME('FIXTURE','TIMESTAMP'")
  );
}

describe('IfcWriter STEP header', () => {
  it('emits a spec-conformant FILE_NAME (no null author/organization/authorization)', async () => {
    const text = await headerText({ author: 'Ada Lovelace', organization: 'Analytical Engines' });
    const line = text.split('\n').find((l) => l.startsWith('FILE_NAME'));
    expect(line).toBeDefined();
    // author and organization are LIST [1:?] OF STRING — never a bare `$` or `($)`.
    expect(line).toContain("('Ada Lovelace')");
    expect(line).toContain("('Analytical Engines')");
    expect(line).not.toMatch(/,\$,/); // no bare-null fields
    expect(line).not.toContain('($)'); // no null list element
  });

  it('escapes embedded quotes in header strings', async () => {
    const text = await headerText({ author: "O'Brien", organization: 'Acme' });
    const line = text.split('\n').find((l) => l.startsWith('FILE_NAME'));
    expect(line).toContain("('O''Brien')");
  });

  it('falls back to a valid empty string when author/organization are unset', async () => {
    const text = await headerText({});
    const line = text.split('\n').find((l) => l.startsWith('FILE_NAME'));
    // Still a LIST with one (empty) STRING element — satisfies the [1:?] cardinality.
    expect(line).toContain("(''),(''),");
    expect(line).not.toContain('($)');
  });
});

describe('STEP real token conformance', () => {
  it('emits no integral-mantissa scientific reals (strict Part 21 grammar)', async () => {
    using model = new BimModel();
    unwrap(model.init({ name: 'Reals' }));
    const bytes = unwrap(
      await toIfc(model, { applicationName: 'reals-test', applicationVersion: '1' })
    );
    const text = new TextDecoder().decode(bytes);
    // The representation context precision is the known emitter of a bare
    // `1E-05`; after normalization it must carry the mantissa point, and no
    // bare scientific real may survive anywhere outside quoted strings.
    expect(text).toContain('1.E-05');
    expect(text).not.toMatch(/[,(=]-?\d+E[+-]?\d+/);
  });
});

describe('IFC serialization unit context', () => {
  it('selects a millimetre context without process-global state', async () => {
    const millimetres = createIfcSerializationContext('MILLIMETRE');
    const metres = createIfcSerializationContext('METRE');

    expect(millimetres).toMatchObject({ lengthUnit: 'MILLIMETRE', siPrefix: 'MILLI' });
    expect(millimetres.lengthFromMm(1_234)).toBe(1_234);
    expect(millimetres.areaFromMm2(1_000_000)).toBe(1_000_000);
    expect(millimetres.volumeFromMm3(1_000_000_000)).toBe(1_000_000_000);
    expect(metres.lengthFromMm(1_234)).toBe(1.234);
    expect(metres.areaFromMm2(1_000_000)).toBe(1);
    expect(metres.volumeFromMm3(1_000_000_000)).toBe(1);

    const millimetreWriter = await serializedUnitFixture('MILLIMETRE');
    const metreWriter = await serializedUnitFixture('METRE');
    expect(millimetreWriter.writerLengthUnit).toBe('MILLIMETRE');
    expect(metreWriter.writerLengthUnit).toBe('METRE');

    // After both writer migration batches, the selected unit owns every SI
    // declaration; square/cubic measures use the same MILLI prefix.
    const text = new TextDecoder().decode(millimetreWriter.bytes);
    expect(text).toContain('.LENGTHUNIT.,.MILLI.,.METRE.');
    expect(text).toContain('.AREAUNIT.,.MILLI.,.SQUARE_METRE.');
    expect(text).toContain('.VOLUMEUNIT.,.MILLI.,.CUBIC_METRE.');
  });

  it('keeps a representative default model byte-equivalent to the pre-context metre lane', async () => {
    using model = buildUnitParityModel();
    const meta = {
      applicationName: 'unit-parity-fixture',
      applicationVersion: '1',
      creationTimestamp: 0,
    } as const;
    const implicit = unwrap(await toIfc(model, meta));
    const explicit = unwrap(await toIfc(model, { ...meta, ifcLengthUnit: 'METRE' }));
    const stableImplicit = stableIfcBytes(implicit);
    const stableExplicit = stableIfcBytes(explicit);

    expect(stableExplicit).toEqual(stableImplicit);
    expect(createHash('sha256').update(stableImplicit).digest('hex')).toBe(
      'da0e3cdffec98cf8c0c9f482c199ee203f620a33437afe046a0bef05922a67ef'
    );
  });
});
