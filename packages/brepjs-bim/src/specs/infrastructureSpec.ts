import { err, ok, type Result } from 'brepjs';
import { z } from 'zod';
import type { BimError } from '../errors/bimError.js';
import { specError } from '../errors/bimError.js';
import type { Profile } from './profile.js';
import { parseProfile, ProfileSchema } from './profile.js';

export type BridgePredefinedType =
  | 'ARCHED'
  | 'CABLE_STAYED'
  | 'CANTILEVER'
  | 'CULVERT'
  | 'FRAMEWORK'
  | 'GIRDER'
  | 'SUSPENSION'
  | 'TRUSS'
  | 'USERDEFINED'
  | 'NOTDEFINED';

export type BridgePartPredefinedType =
  | 'ABUTMENT'
  | 'DECK'
  | 'DECK_SEGMENT'
  | 'FOUNDATION'
  | 'PIER'
  | 'PIER_SEGMENT'
  | 'PYLON'
  | 'SUBSTRUCTURE'
  | 'SUPERSTRUCTURE'
  | 'SURFACESTRUCTURE'
  | 'USERDEFINED'
  | 'NOTDEFINED';

export type FacilityUsageType =
  'LATERAL' | 'LONGITUDINAL' | 'REGION' | 'VERTICAL' | 'USERDEFINED' | 'NOTDEFINED';

export type MemberPredefinedType =
  | 'ARCH_SEGMENT'
  | 'BRACE'
  | 'CHORD'
  | 'COLLAR'
  | 'MEMBER'
  | 'MULLION'
  | 'PLATE'
  | 'POST'
  | 'PURLIN'
  | 'RAFTER'
  | 'STAY_CABLE'
  | 'STIFFENING_RIB'
  | 'STRINGER'
  | 'STRUCTURALCABLE'
  | 'STRUT'
  | 'STUD'
  | 'SUSPENDER'
  | 'SUSPENSION_CABLE'
  | 'TIEBAR'
  | 'USERDEFINED'
  | 'NOTDEFINED';

export interface RigidPlacementSpec {
  readonly origin: [number, number, number];
  readonly axisX: [number, number, number];
  readonly axisZ: [number, number, number];
}

export interface BridgeSpec extends RigidPlacementSpec {
  readonly name: string;
  readonly description?: string | undefined;
  readonly predefinedType?: BridgePredefinedType | undefined;
}

export interface BridgePartSpec extends RigidPlacementSpec {
  readonly name: string;
  readonly description?: string | undefined;
  readonly usageType: FacilityUsageType;
  readonly predefinedType?: BridgePartPredefinedType | undefined;
}

/** A prismatic civil member: its centred profile is extruded along local +X. */
export interface MemberSpec extends RigidPlacementSpec {
  readonly name: string;
  readonly length: number;
  readonly profile: Profile;
  readonly predefinedType?: MemberPredefinedType | undefined;
  readonly materialName: string;
}

const unitVector = z
  .tuple([z.number(), z.number(), z.number()])
  .refine((value) => Math.abs(value[0] ** 2 + value[1] ** 2 + value[2] ** 2 - 1) < 1e-6, {
    error: 'must be a unit vector',
  });

const placementFields = {
  origin: z.tuple([z.number(), z.number(), z.number()]),
  axisX: unitVector,
  axisZ: unitVector,
};

function orthogonal<T extends { axisX: [number, number, number]; axisZ: [number, number, number] }>(
  schema: z.ZodType<T>
): z.ZodType<T> {
  return schema.superRefine((value, ctx) => {
    const dot =
      value.axisX[0] * value.axisZ[0] +
      value.axisX[1] * value.axisZ[1] +
      value.axisX[2] * value.axisZ[2];
    if (Math.abs(dot) > 1e-6) {
      ctx.addIssue({
        code: 'custom',
        message: 'axisX and axisZ must be orthogonal',
        path: ['axisZ'],
      });
    }
  });
}

const BridgeSpecSchema = orthogonal(
  z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    ...placementFields,
    predefinedType: z
      .enum([
        'ARCHED',
        'CABLE_STAYED',
        'CANTILEVER',
        'CULVERT',
        'FRAMEWORK',
        'GIRDER',
        'SUSPENSION',
        'TRUSS',
        'USERDEFINED',
        'NOTDEFINED',
      ])
      .optional(),
  }) as z.ZodType<BridgeSpec>
);

const BridgePartSpecSchema = orthogonal(
  z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    ...placementFields,
    usageType: z.enum([
      'LATERAL',
      'LONGITUDINAL',
      'REGION',
      'VERTICAL',
      'USERDEFINED',
      'NOTDEFINED',
    ]),
    predefinedType: z
      .enum([
        'ABUTMENT',
        'DECK',
        'DECK_SEGMENT',
        'FOUNDATION',
        'PIER',
        'PIER_SEGMENT',
        'PYLON',
        'SUBSTRUCTURE',
        'SUPERSTRUCTURE',
        'SURFACESTRUCTURE',
        'USERDEFINED',
        'NOTDEFINED',
      ])
      .optional(),
  }) as z.ZodType<BridgePartSpec>
);

const MemberSpecSchema = orthogonal(
  z.object({
    name: z.string().min(1),
    length: z.number().positive(),
    profile: ProfileSchema,
    ...placementFields,
    predefinedType: z
      .enum([
        'ARCH_SEGMENT',
        'BRACE',
        'CHORD',
        'COLLAR',
        'MEMBER',
        'MULLION',
        'PLATE',
        'POST',
        'PURLIN',
        'RAFTER',
        'STAY_CABLE',
        'STIFFENING_RIB',
        'STRINGER',
        'STRUCTURALCABLE',
        'STRUT',
        'STUD',
        'SUSPENDER',
        'SUSPENSION_CABLE',
        'TIEBAR',
        'USERDEFINED',
        'NOTDEFINED',
      ])
      .optional(),
    materialName: z.string().min(1),
  }) as z.ZodType<MemberSpec>
);

function parseWithSchema<T>(
  input: unknown,
  schema: z.ZodType<T>,
  code: string
): Result<T, BimError> {
  const result = schema.safeParse(input);
  return result.success
    ? ok(result.data)
    : err(specError(code, result.error.message, result.error));
}

export function parseBridgeSpec(input: unknown): Result<BridgeSpec, BimError> {
  return parseWithSchema(input, BridgeSpecSchema, 'INVALID_BRIDGE_SPEC');
}

export function parseBridgePartSpec(input: unknown): Result<BridgePartSpec, BimError> {
  return parseWithSchema(input, BridgePartSpecSchema, 'INVALID_BRIDGE_PART_SPEC');
}

export function parseMemberSpec(input: unknown): Result<MemberSpec, BimError> {
  const result = parseWithSchema(input, MemberSpecSchema, 'INVALID_MEMBER_SPEC');
  if (!result.ok) return result;
  const profile = parseProfile(result.value.profile);
  return profile.ok ? result : err(profile.error);
}
