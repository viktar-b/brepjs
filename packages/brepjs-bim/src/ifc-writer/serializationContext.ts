export type IfcLengthUnit = 'METRE' | 'MILLIMETRE';

export interface IfcSerializationContext {
  readonly lengthUnit: IfcLengthUnit;
  readonly siPrefix: 'MILLI' | null;
  readonly lengthFromMm: (valueMm: number) => number;
  readonly areaFromMm2: (valueMm2: number) => number;
  readonly volumeFromMm3: (valueMm3: number) => number;
}

/** Create one immutable, model-owned policy for converting authored millimetres to IFC values. */
export function createIfcSerializationContext(
  lengthUnit: IfcLengthUnit = 'METRE'
): IfcSerializationContext {
  const lengthScale = lengthUnit === 'METRE' ? 1 / 1_000 : 1;
  return Object.freeze({
    lengthUnit,
    siPrefix: lengthUnit === 'METRE' ? null : 'MILLI',
    lengthFromMm: (valueMm: number) => valueMm * lengthScale,
    areaFromMm2: (valueMm2: number) => valueMm2 * lengthScale ** 2,
    volumeFromMm3: (valueMm3: number) => valueMm3 * lengthScale ** 3,
  });
}

export const DEFAULT_IFC_SERIALIZATION_CONTEXT = createIfcSerializationContext();
