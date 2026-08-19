import type { Result, ValidSolid } from 'brepjs';
import type { BimError } from '../errors/bimError.js';
import type { BeamSpec } from '../specs/beamSpec.js';
import type { MemberSpec } from '../specs/infrastructureSpec.js';
import { beamToSolid } from './beamFns.js';

/** Adapt the shared prismatic Product Body recipe without conflating IFC types. */
export function memberBodySpec(spec: MemberSpec): BeamSpec {
  return {
    length: spec.length,
    profile: spec.profile,
    origin: spec.origin,
    axisX: spec.axisX,
    axisZ: spec.axisZ,
    materialName: spec.materialName,
  };
}

export function memberToSolid(spec: MemberSpec): Result<ValidSolid, BimError> {
  return beamToSolid(memberBodySpec(spec));
}
