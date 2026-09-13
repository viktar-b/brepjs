import { err, ok, type Result, type ValidSolid } from 'brepjs';
import { ifcError, type BimError } from '../errors/bimError.js';
import type { WallSpec } from '../specs/wallSpec.js';
import {
  measureProductBodyVolume,
  type NonEmpty,
  type ProductBodyVolumeDependencies,
} from '../types/productBody.js';
import { toIfcLengthM } from '../units/units.js';

export interface ExactWallQuantityValues {
  readonly lengthM: number;
  readonly widthM: number;
  readonly heightM: number;
  readonly netVolumeM3: number;
}

export type ExactWallQuantityDependencies = ProductBodyVolumeDependencies;

export interface ExactWallQuantityInput {
  readonly spec: WallSpec;
  readonly solids: NonEmpty<ValidSolid>;
  readonly dependencies?: ExactWallQuantityDependencies | undefined;
}

export function deriveExactWallQuantities(
  input: ExactWallQuantityInput
): Result<ExactWallQuantityValues, BimError> {
  const measured = measureProductBodyVolume(
    { kind: 'AUTHORITATIVE', items: input.solids },
    input.dependencies
  );
  if (!measured.ok) return exactVolumeError(measured.error);
  const volumeMm3 = measured.value;

  return ok({
    lengthM: toIfcLengthM(input.spec.length),
    widthM: toIfcLengthM(input.spec.thickness),
    heightM: toIfcLengthM(input.spec.height),
    netVolumeM3: volumeMm3 / 1_000_000_000,
  });
}

function exactVolumeError(cause: unknown): Result<never, BimError> {
  return err(
    ifcError(
      'IFC_EXACT_WALL_QUANTITY_DERIVATION_FAILED',
      'Failed to derive a positive finite NetVolume for an exact wall Product Body',
      cause
    )
  );
}
