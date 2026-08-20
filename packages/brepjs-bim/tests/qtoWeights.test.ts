import { describe, it, expect, vi } from 'vitest';
import * as WebIFC from 'web-ifc';
import {
  MATERIAL_DENSITY_KG_M3,
  densityFor,
  computeWeightKg,
  writeWeightQuantity,
} from '../src/psets/qtoWeights.js';
import { IfcWriter } from '../src/ifc-writer/ifcWriter.js';
import { writeWallBaseQuantities } from '../src/ifc-writer/psetWriter.js';
import { writeHeader } from '../src/ifc-writer/headerWriter.js';
import { writeWallGeometry } from '../src/ifc-writer/geometryWriter.js';
import { writeWallEntity } from '../src/ifc-writer/entityWriter.js';
import { deriveIfcGuidSync } from '../src/identity/guidDerivation.js';

const META = { applicationName: 'brepjs-bim', applicationVersion: '0.1.0' };

function quantityValue(
  api: WebIFC.IfcAPI,
  modelId: number,
  type: number,
  name: string,
  valueField: string
): number {
  const ids = api.GetLineIDsWithType(modelId, type);
  let line: Record<string, unknown> | undefined;
  for (let index = 0; index < ids.size(); index++) {
    const candidate = api.GetLine(modelId, ids.get(index)) as Record<string, unknown>;
    if ((candidate['Name'] as { value?: string } | undefined)?.value === name) {
      line = candidate;
      break;
    }
  }
  const value = (line?.[valueField] as { value?: number } | undefined)?.value;
  if (value === undefined) throw new Error(`${name} quantity missing`);
  return value;
}

async function serializedWallQuantities(lengthUnit: 'METRE' | 'MILLIMETRE'): Promise<{
  api: WebIFC.IfcAPI;
  modelId: number;
}> {
  const writerResult = await IfcWriter.create(undefined, undefined, undefined, lengthUnit);
  if (!writerResult.ok) throw new Error(writerResult.error.message);
  const writer = writerResult.value;
  writer.setModelScope(`quantity-${lengthUnit}`);
  const { ownerHistoryId, geomSubContextId } = writeHeader(writer, META);
  const spec = {
    length: 5_000,
    height: 3_000,
    thickness: 250,
    origin: [0, 0, 0] as [number, number, number],
    axisX: [1, 0, 0] as [number, number, number],
    axisZ: [0, 0, 1] as [number, number, number],
    materialName: 'Concrete',
  };
  const geometry = writeWallGeometry(writer, spec, geomSubContextId, null);
  const wallId = writeWallEntity(
    writer,
    deriveIfcGuidSync(`quantity-wall-${lengthUnit}`),
    'Quantity Wall',
    ownerHistoryId,
    geometry.localPlacementId,
    geometry.productDefinitionShapeId
  );
  writeWallBaseQuantities(writer, ownerHistoryId, wallId, spec, [], 2_400);
  const saved = writer.save();
  if (!saved.ok) throw new Error(saved.error.message);

  const api = new WebIFC.IfcAPI();
  await api.Init();
  return { api, modelId: api.OpenModel(saved.value) };
}

describe('qtoWeights — weight computation', () => {
  it('computes weight = volume * density for a known case', () => {
    // 2 m³ of concrete at 2400 kg/m³ = 4800 kg.
    expect(computeWeightKg(2, 2400)).toBe(4800);
  });

  it('returns zero for zero volume', () => {
    expect(computeWeightKg(0, 2400)).toBe(0);
  });

  it('returns zero for zero density', () => {
    expect(computeWeightKg(2, 0)).toBe(0);
  });
});

describe('qtoWeights — density table', () => {
  it('exposes a non-empty density table with positive values', () => {
    const entries = Object.entries(MATERIAL_DENSITY_KG_M3);
    expect(entries.length).toBeGreaterThan(0);
    for (const [, density] of entries) {
      expect(density).toBeGreaterThan(0);
    }
  });

  it('resolves a known material name (case-insensitive)', () => {
    expect(densityFor('Concrete')).toBe(MATERIAL_DENSITY_KG_M3['concrete']);
    expect(densityFor('CONCRETE')).toBe(MATERIAL_DENSITY_KG_M3['concrete']);
  });

  it('returns undefined for an unknown material name', () => {
    expect(densityFor('unobtainium')).toBeUndefined();
  });
});

describe('qtoWeights — quantity builder', () => {
  it('emits an IfcQuantityWeight line with WeightValue = volume * density', () => {
    let nextId = 100;
    const written: Array<{ expressID: number } & Record<string, unknown>> = [];
    const w = {
      nextId: () => nextId++,
      mkType: (type: number, value: unknown) => ({ type, value }),
      writeLine: (entity: { expressID: number } & Record<string, unknown>) => {
        written.push(entity);
        return entity.expressID;
      },
    };

    const id = writeWeightQuantity(w, 'GrossWeight', 2, 2400);

    expect(id).toBe(100);
    expect(written).toHaveLength(1);
    const line = written[0];
    expect(line?.type).toBe(WebIFC.IFCQUANTITYWEIGHT);
    expect(line?.['Name']).toEqual({ type: WebIFC.IFCLABEL, value: 'GrossWeight' });
    expect(line?.['WeightValue']).toEqual({
      type: WebIFC.IFCMASSMEASURE,
      value: 4800,
    });
  });

  it('does not warn or throw for a normal density', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const w = {
      nextId: () => 1,
      mkType: (type: number, value: unknown) => ({ type, value }),
      writeLine: (entity: { expressID: number } & Record<string, unknown>) => entity.expressID,
    };
    writeWeightQuantity(w, 'GrossWeight', 1, 2400);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('base quantities — serialization unit context', () => {
  it('derives length, area, and volume measures from the writer unit context', async () => {
    for (const [lengthUnit, expected] of [
      ['METRE', { length: 5, area: 15, volume: 3.75 }],
      ['MILLIMETRE', { length: 5_000, area: 15_000_000, volume: 3_750_000_000 }],
    ] as const) {
      const { api, modelId } = await serializedWallQuantities(lengthUnit);
      expect(quantityValue(api, modelId, WebIFC.IFCQUANTITYLENGTH, 'Length', 'LengthValue')).toBe(
        expected.length
      );
      expect(
        quantityValue(api, modelId, WebIFC.IFCQUANTITYAREA, 'GrossSideArea', 'AreaValue')
      ).toBe(expected.area);
      expect(
        quantityValue(api, modelId, WebIFC.IFCQUANTITYVOLUME, 'GrossVolume', 'VolumeValue')
      ).toBeCloseTo(expected.volume, 9);
      expect(
        quantityValue(api, modelId, WebIFC.IFCQUANTITYWEIGHT, 'GrossWeight', 'WeightValue')
      ).toBe(9_000);
      api.CloseModel(modelId);
    }
  });
});
