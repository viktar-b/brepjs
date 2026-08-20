import { describe, it, expect, vi } from 'vitest';
import * as WebIFC from 'web-ifc';
import {
  MATERIAL_DENSITY_KG_M3,
  densityFor,
  computeWeightKg,
  writeWeightQuantity,
} from '../src/psets/qtoWeights.js';
import type { IfcWriter } from '../src/ifc-writer/ifcWriter.js';
import { createIfcSerializationContext } from '../src/ifc-writer/serializationContext.js';
import { writeWallBaseQuantities } from '../src/ifc-writer/psetWriter.js';

function quantityWriter(lengthUnit: 'METRE' | 'MILLIMETRE'): {
  writer: IfcWriter;
  written: Array<{ expressID: number } & Record<string, unknown>>;
} {
  let nextId = 100;
  const written: Array<{ expressID: number } & Record<string, unknown>> = [];
  const writer = {
    serializationContext: createIfcSerializationContext(lengthUnit),
    nextId: () => nextId++,
    guidFor: (expressId: number) => `guid-${expressId}`,
    ref: (expressId: number) => ({ value: expressId }),
    mkType: (type: number, value: unknown) => ({ type, value }),
    writeLine: (entity: { expressID: number } & Record<string, unknown>) => {
      written.push(entity);
      return entity.expressID;
    },
  } as unknown as IfcWriter;
  return { writer, written };
}

function quantityValue(
  written: Array<{ expressID: number } & Record<string, unknown>>,
  type: number,
  name: string,
  valueField: string
): number {
  const line = written.find(
    (candidate) =>
      candidate.type === type &&
      (candidate['Name'] as { value?: string } | undefined)?.value === name
  );
  const value = (line?.[valueField] as { value?: number } | undefined)?.value;
  if (value === undefined) throw new Error(`${name} quantity missing`);
  return value;
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
  it('derives length, area, and volume measures from the writer unit context', () => {
    for (const [lengthUnit, expected] of [
      ['METRE', { length: 5, area: 15, volume: 3.75 }],
      ['MILLIMETRE', { length: 5_000, area: 15_000_000, volume: 3_750_000_000 }],
    ] as const) {
      const { writer, written } = quantityWriter(lengthUnit);
      writeWallBaseQuantities(
        writer,
        1,
        2,
        {
          length: 5_000,
          height: 3_000,
          thickness: 250,
          origin: [0, 0, 0],
          axisX: [1, 0, 0],
          axisZ: [0, 0, 1],
          materialName: 'Concrete',
        },
        [],
        2_400
      );

      expect(quantityValue(written, WebIFC.IFCQUANTITYLENGTH, 'Length', 'LengthValue')).toBe(
        expected.length
      );
      expect(quantityValue(written, WebIFC.IFCQUANTITYAREA, 'GrossSideArea', 'AreaValue')).toBe(
        expected.area
      );
      expect(
        quantityValue(written, WebIFC.IFCQUANTITYVOLUME, 'GrossVolume', 'VolumeValue')
      ).toBeCloseTo(expected.volume, 9);
      expect(quantityValue(written, WebIFC.IFCQUANTITYWEIGHT, 'GrossWeight', 'WeightValue')).toBe(
        9_000
      );
    }
  });
});
