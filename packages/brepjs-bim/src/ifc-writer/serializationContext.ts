export type IfcLengthUnit = 'METRE' | 'MILLIMETRE';

export class IfcSerializationContext {
  readonly lengthUnit: IfcLengthUnit;
  readonly siPrefix: 'MILLI' | null;

  private constructor(lengthUnit: IfcLengthUnit) {
    this.lengthUnit = lengthUnit;
    this.siPrefix = lengthUnit === 'METRE' ? null : 'MILLI';
    Object.freeze(this);
  }

  static create(lengthUnit: IfcLengthUnit): IfcSerializationContext {
    return new IfcSerializationContext(lengthUnit);
  }

  lengthFromMm(valueMm: number): number {
    return this.lengthUnit === 'METRE' ? valueMm / 1_000 : valueMm;
  }

  /** Convert legacy public CRS coordinates, whose contract is explicitly metres. */
  lengthFromM(valueM: number): number {
    return this.lengthFromMm(valueM * 1_000);
  }

  areaFromMm2(valueMm2: number): number {
    return this.lengthUnit === 'METRE' ? valueMm2 / 1_000_000 : valueMm2;
  }

  volumeFromMm3(valueMm3: number): number {
    return this.lengthUnit === 'METRE' ? valueMm3 / 1_000_000_000 : valueMm3;
  }
}

/** Create one immutable, model-owned policy for converting authored millimetres to IFC values. */
export function createIfcSerializationContext(
  lengthUnit: IfcLengthUnit = 'METRE'
): IfcSerializationContext {
  return IfcSerializationContext.create(lengthUnit);
}

export const DEFAULT_IFC_SERIALIZATION_CONTEXT = createIfcSerializationContext();
