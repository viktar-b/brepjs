import { IfcAPI } from 'web-ifc';
import * as WebIFC from 'web-ifc';
import type { ValidationIssue, ValidationReport } from './severity.js';
import { issue, emptyReport, appendIssues } from './severity.js';
import { initIfcApi } from '../ifcRuntime.js';
import { collectIfcObservations, type ImportedIfcObservations } from '../import/observations.js';
import { SpfReader } from '../import/spfReader.js';
import { unwrap } from 'brepjs';

/**
 * Human-readable names of the key entities whose per-type counts are compared
 * across a write→read→re-write round-trip. The keys double as `typeCounts` map
 * keys so callers can assert on stable names rather than numeric web-ifc codes.
 */
export const KEY_ENTITY_NAMES = [
  'IfcProject',
  'IfcSite',
  'IfcWall',
  'IfcSlab',
  'IfcBeam',
  'IfcColumn',
  'IfcBridge',
  'IfcBridgePart',
  'IfcMember',
  'IfcSign',
  'IfcEarthworksFill',
  'IfcFooting',
  'IfcRailing',
  'IfcRelContainedInSpatialStructure',
  'IfcRelAggregates',
  'IfcPropertySet',
] as const;

export type KeyEntityName = (typeof KEY_ENTITY_NAMES)[number];

const KEY_ENTITY_TYPES: ReadonlyArray<readonly [KeyEntityName, number]> = [
  ['IfcProject', WebIFC.IFCPROJECT],
  ['IfcSite', WebIFC.IFCSITE],
  ['IfcWall', WebIFC.IFCWALL],
  ['IfcSlab', WebIFC.IFCSLAB],
  ['IfcBeam', WebIFC.IFCBEAM],
  ['IfcColumn', WebIFC.IFCCOLUMN],
  ['IfcBridge', WebIFC.IFCBRIDGE],
  ['IfcBridgePart', WebIFC.IFCBRIDGEPART],
  ['IfcMember', WebIFC.IFCMEMBER],
  ['IfcSign', WebIFC.IFCSIGN],
  ['IfcEarthworksFill', WebIFC.IFCEARTHWORKSFILL],
  ['IfcFooting', WebIFC.IFCFOOTING],
  ['IfcRailing', WebIFC.IFCRAILING],
  ['IfcRelContainedInSpatialStructure', WebIFC.IFCRELCONTAINEDINSPATIALSTRUCTURE],
  ['IfcRelAggregates', WebIFC.IFCRELAGGREGATES],
  ['IfcPropertySet', WebIFC.IFCPROPERTYSET],
];

export interface EntityCounts {
  /** Total number of entity lines in the model. */
  readonly totalCount: number;
  /** Count per key entity, keyed by IFC entity name. */
  readonly typeCounts: Readonly<Record<string, number>>;
}

export interface RoundTripReport extends ValidationReport {
  readonly firstPass: RoundTripPass;
  readonly secondPass: RoundTripPass;
}

export type RoundTripPass = EntityCounts & ImportedIfcObservations;

/**
 * Open the given IFC bytes with web-ifc and count the total entity lines plus
 * the per-type counts for the key entities. The model is always closed before
 * returning, even if reading throws.
 */
export async function firstPassCounts(bytes: Uint8Array): Promise<EntityCounts> {
  const api = new IfcAPI();
  await initIfcApi(api);
  const modelId = api.OpenModel(bytes);
  try {
    return collectCounts(api, modelId);
  } finally {
    api.CloseModel(modelId);
  }
}

/** Reads the complete canonical observation set from one IFC byte buffer. */
export async function observeIfc(bytes: Uint8Array): Promise<RoundTripPass> {
  const reader = unwrap(await SpfReader.create(bytes));
  try {
    const observations = collectIfcObservations(reader);
    return {
      ...observations,
      totalCount: observations.totalEntityCount,
      typeCounts: Object.fromEntries(
        KEY_ENTITY_NAMES.map((name) => [name, observations.entityCounts[name.toUpperCase()] ?? 0])
      ),
    };
  } finally {
    reader.close();
  }
}

/**
 * Re-open the bytes, re-serialize, then re-open the re-serialized bytes and
 * count again. Models are always closed, even on failure.
 */
async function resaveIfc(bytes: Uint8Array): Promise<Uint8Array> {
  const api = new IfcAPI();
  await initIfcApi(api);
  const sourceModelId = api.OpenModel(bytes);
  try {
    return api.SaveModel(sourceModelId);
  } finally {
    api.CloseModel(sourceModelId);
  }
}

function collectCounts(api: IfcAPI, modelId: number): EntityCounts {
  const allLines = api.GetAllLines(modelId);
  const totalCount = allLines.size();

  const typeCounts: Record<string, number> = {};
  for (const [name, type] of KEY_ENTITY_TYPES) {
    const ids = api.GetLineIDsWithType(modelId, type);
    typeCounts[name] = ids.size();
  }

  return { totalCount, typeCounts };
}

/**
 * Compare two count snapshots and report any delta. A difference in the total
 * entity-line count or in any key per-type count is an error: a stable model
 * must round-trip without gaining or losing entities.
 */
export function compareCounts(first: EntityCounts, second: EntityCounts): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (first.totalCount !== second.totalCount) {
    issues.push(
      issue(
        'error',
        'ROUNDTRIP_TOTAL_COUNT_DELTA',
        `Total entity-line count changed across round-trip: ${first.totalCount} → ${second.totalCount}`,
        undefined,
        { first: first.totalCount, second: second.totalCount }
      )
    );
  }

  for (const name of KEY_ENTITY_NAMES) {
    const firstCount = first.typeCounts[name] ?? 0;
    const secondCount = second.typeCounts[name] ?? 0;
    if (firstCount !== secondCount) {
      issues.push(
        issue(
          'error',
          'ROUNDTRIP_TYPE_COUNT_DELTA',
          `${name} count changed across round-trip: ${firstCount} → ${secondCount}`,
          name,
          { first: firstCount, second: secondCount }
        )
      );
    }
  }

  return issues;
}

/** Compares every deterministic fact required by the Bridge round-trip contract. */
export function compareIfcObservations(
  first: ImportedIfcObservations,
  second: ImportedIfcObservations
): ValidationIssue[] {
  return [
    ...compareSetField(
      'ROUNDTRIP_GLOBAL_ID_DELTA',
      'GlobalId set',
      first.globalIds,
      second.globalIds
    ),
    ...compareSetField(
      'ROUNDTRIP_DECOMPOSITION_DELTA',
      'spatial decomposition',
      first.decomposition,
      second.decomposition
    ),
    ...compareSetField(
      'ROUNDTRIP_CONTAINMENT_DELTA',
      'product containment',
      first.containment,
      second.containment
    ),
    ...compareField(
      'ROUNDTRIP_COMPOSITION_DELTA',
      'spatial composition',
      spatialField(first, 'composition'),
      spatialField(second, 'composition')
    ),
    ...compareField(
      'ROUNDTRIP_SUBDIVISION_DELTA',
      'spatial subdivision',
      spatialField(first, 'subdivision'),
      spatialField(second, 'subdivision')
    ),
    ...compareField(
      'ROUNDTRIP_LOCAL_PLACEMENT_DELTA',
      'parent-relative Local Placements',
      placementFields(first),
      placementFields(second)
    ),
    ...compareField(
      'ROUNDTRIP_PROJECT_UNIT_DELTA',
      'project length unit',
      first.projectLengthUnit,
      second.projectLengthUnit
    ),
    ...compareField(
      'ROUNDTRIP_MAP_UNIT_DELTA',
      'projected CRS map unit',
      first.mapConversions.map((conversion) => conversion.targetCrs?.mapUnit ?? null),
      second.mapConversions.map((conversion) => conversion.targetCrs?.mapUnit ?? null)
    ),
    ...compareField(
      'ROUNDTRIP_CRS_DELTA',
      'coordinate reference system',
      crsFields(first),
      crsFields(second)
    ),
    ...compareField(
      'ROUNDTRIP_MAP_CONVERSION_COUNT_DELTA',
      'map conversion count',
      first.mapConversionCount,
      second.mapConversionCount
    ),
    ...compareField(
      'ROUNDTRIP_MAP_CONVERSION_DELTA',
      'map conversion values',
      mapFields(first),
      mapFields(second)
    ),
  ];
}

function spatialField(
  observation: ImportedIfcObservations,
  field: 'composition' | 'subdivision'
): ReadonlyArray<readonly [string, string | null]> {
  return observation.spatialSemantics.map((item) => [item.guid, item[field]] as const);
}

function placementFields(observation: ImportedIfcObservations): unknown {
  return observation.localPlacements.map((placement) => ({
    guid: placement.guid,
    parentGuid: placement.parentGuid,
    originMm: placement.originMm,
    axisX: placement.axisX,
    axisZ: placement.axisZ,
  }));
}

function crsFields(observation: ImportedIfcObservations): unknown {
  return observation.mapConversions.map((conversion) => {
    const crs = conversion.targetCrs;
    if (crs === null) return null;
    return {
      name: crs.name,
      description: crs.description,
      geodeticDatum: crs.geodeticDatum,
      verticalDatum: crs.verticalDatum,
      mapProjection: crs.mapProjection,
      mapZone: crs.mapZone,
    };
  });
}

function mapFields(observation: ImportedIfcObservations): unknown {
  return observation.mapConversions.map((conversion) => ({
    eastings: conversion.eastings,
    northings: conversion.northings,
    orthogonalHeight: conversion.orthogonalHeight,
    xAxisAbscissa: conversion.xAxisAbscissa,
    xAxisOrdinate: conversion.xAxisOrdinate,
    scale: conversion.scale,
  }));
}

function compareSetField(
  code: string,
  label: string,
  first: readonly string[],
  second: readonly string[]
): ValidationIssue[] {
  if (JSON.stringify(first) === JSON.stringify(second)) return [];
  const firstSet = new Set(first);
  const secondSet = new Set(second);
  return [
    issue('error', code, `${label} changed across round-trip`, undefined, {
      path: label,
      missing: first.filter((value) => !secondSet.has(value)),
      added: second.filter((value) => !firstSet.has(value)),
    }),
  ];
}

function compareField(
  code: string,
  label: string,
  first: unknown,
  second: unknown
): ValidationIssue[] {
  if (JSON.stringify(first) === JSON.stringify(second)) return [];
  return [
    issue('error', code, `${label} changed across round-trip`, undefined, {
      path: label,
      first,
      second,
    }),
  ];
}

/**
 * Write→read→re-write round-trip self-check. Opens the produced IFC bytes,
 * re-saves them, re-opens the re-saved bytes, and reports any count delta in the
 * total entity-line count or the key per-type counts (per the severity model).
 */
export async function checkRoundTrip(bytes: Uint8Array): Promise<RoundTripReport> {
  const firstPass = await observeIfc(bytes);
  const secondPass = await observeIfc(await resaveIfc(bytes));
  const report = appendIssues(emptyReport(), [
    ...compareCounts(firstPass, secondPass),
    ...compareIfcObservations(firstPass, secondPass),
  ]);
  return { ...report, firstPass, secondPass };
}
