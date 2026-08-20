import * as WebIFC from 'web-ifc';
import type { Vec3 } from './placement.js';
import { decomposePlacement, readAxis2Placement3D, readLengthScale } from './placement.js';
import type { SpfReader } from './spfReader.js';

export interface SpatialSemanticObservation {
  readonly guid: string;
  readonly name: string;
  readonly ifcType: string;
  readonly composition: string | null;
  readonly subdivision: string | null;
}

export interface LocalPlacementObservation {
  readonly guid: string;
  readonly name: string;
  readonly ifcType: string;
  readonly parentGuid: string | null;
  readonly originMm: Vec3;
  readonly axisX: Vec3;
  readonly axisZ: Vec3;
}

export interface IfcUnitObservation {
  readonly kind: 'SI' | 'CONVERSION_BASED' | 'UNKNOWN';
  readonly unitType: string | null;
  readonly prefix: string | null;
  readonly name: string | null;
  readonly metresPerUnit: number | null;
}

export interface IfcCrsObservation {
  readonly name: string | null;
  readonly description: string | null;
  readonly geodeticDatum: string | null;
  readonly verticalDatum: string | null;
  readonly mapProjection: string | null;
  readonly mapZone: string | null;
  readonly mapUnit: IfcUnitObservation | null;
}

export interface IfcMapConversionObservation {
  readonly targetCrs: IfcCrsObservation | null;
  readonly eastings: number | null;
  readonly northings: number | null;
  readonly orthogonalHeight: number | null;
  readonly xAxisAbscissa: number | null;
  readonly xAxisOrdinate: number | null;
  readonly scale: number | null;
}

/** Canonical IFC facts consumed by relationship-aware round-trip validation. */
export interface ImportedIfcObservations {
  readonly globalIds: readonly string[];
  readonly totalEntityCount: number;
  readonly entityCounts: Readonly<Record<string, number>>;
  /** Sorted `parent GlobalId > child GlobalId` aggregation edges. */
  readonly decomposition: readonly string[];
  /** Sorted `spatial GlobalId > product GlobalId` containment edges. */
  readonly containment: readonly string[];
  readonly spatialSemantics: readonly SpatialSemanticObservation[];
  readonly localPlacements: readonly LocalPlacementObservation[];
  /** Raw declared project length unit; absence stays null rather than becoming metre. */
  readonly projectLengthUnit: IfcUnitObservation | null;
  readonly mapConversionCount: number;
  /** Raw nullable map declarations, including every conversion in the file. */
  readonly mapConversions: readonly IfcMapConversionObservation[];
}

interface RootRecord {
  readonly expressId: number;
  readonly guid: string;
  readonly name: string;
  readonly ifcType: string;
  readonly objectPlacementId: number | null;
  readonly line: Record<string, unknown>;
}

const SPATIAL_TYPES = new Set([
  'IFCPROJECT',
  'IFCSITE',
  'IFCBUILDING',
  'IFCBUILDINGSTOREY',
  'IFCBRIDGE',
  'IFCBRIDGEPART',
]);

/** Reads deterministic relationship, identity, placement, unit, and map facts. */
export function collectIfcObservations(reader: SpfReader): ImportedIfcObservations {
  const allLines = reader.getAllLines();
  const roots: RootRecord[] = [];
  const rootsByExpressId = new Map<number, RootRecord>();
  const entityCounts: Record<string, number> = {};

  for (const expressId of allLines) {
    const ifcType = reader.typeNameOf(expressId);
    entityCounts[ifcType] = (entityCounts[ifcType] ?? 0) + 1;
    const line = reader.getLine<Record<string, unknown>>(expressId);
    if (line === null) continue;
    const guid = stringValue(line['GlobalId']);
    if (guid === null) continue;
    const root: RootRecord = {
      expressId,
      guid,
      name: reader.decodeText(stringValue(line['Name']) ?? ''),
      ifcType,
      objectPlacementId: refId(line['ObjectPlacement']),
      line,
    };
    roots.push(root);
    rootsByExpressId.set(expressId, root);
  }

  const projectLengthScale = readLengthScale(reader);
  const mapConversions = readMapConversions(reader);
  const placementOwner = new Map<number, RootRecord>();
  for (const root of roots) {
    if (root.objectPlacementId !== null) placementOwner.set(root.objectPlacementId, root);
  }

  return {
    globalIds: roots.map((root) => root.guid).sort(),
    totalEntityCount: allLines.length,
    entityCounts: Object.fromEntries(
      Object.entries(entityCounts).sort(([left], [right]) => left.localeCompare(right))
    ),
    decomposition: relationshipEdges(
      reader,
      WebIFC.IFCRELAGGREGATES,
      'RelatingObject',
      'RelatedObjects',
      rootsByExpressId
    ),
    containment: relationshipEdges(
      reader,
      WebIFC.IFCRELCONTAINEDINSPATIALSTRUCTURE,
      'RelatingStructure',
      'RelatedElements',
      rootsByExpressId
    ),
    spatialSemantics: roots
      .filter((root) => SPATIAL_TYPES.has(root.ifcType))
      .map((root) => ({
        guid: root.guid,
        name: root.name,
        ifcType: root.ifcType,
        composition: stringValue(root.line['CompositionType']),
        subdivision: stringValue(root.line['UsageType']),
      }))
      .sort(compareByGuid),
    localPlacements: roots
      .flatMap((root): LocalPlacementObservation[] => {
        if (root.objectPlacementId === null) return [];
        const localPlacement = reader.getLine<Record<string, unknown>>(root.objectPlacementId);
        const relativePlacementId = refId(localPlacement?.['RelativePlacement']);
        if (relativePlacementId === null) return [];
        const matrix = readAxis2Placement3D(reader, relativePlacementId, projectLengthScale);
        if (matrix === null) return [];
        const frame = decomposePlacement(matrix);
        const parentPlacementId = refId(localPlacement?.['PlacementRelTo']);
        return [
          {
            guid: root.guid,
            name: root.name,
            ifcType: root.ifcType,
            parentGuid:
              parentPlacementId === null
                ? null
                : (placementOwner.get(parentPlacementId)?.guid ?? null),
            originMm: frame.origin,
            axisX: frame.axisX,
            axisZ: frame.axisZ,
          },
        ];
      })
      .sort(compareByGuid),
    projectLengthUnit: readProjectLengthUnit(reader),
    mapConversionCount: mapConversions.length,
    mapConversions,
  };
}

function readProjectLengthUnit(reader: SpfReader): IfcUnitObservation | null {
  for (const assignmentId of reader.getLinesOfType(WebIFC.IFCUNITASSIGNMENT)) {
    const assignment = reader.getLine<Record<string, unknown>>(assignmentId);
    for (const unitId of refIds(assignment?.['Units'])) {
      const observation = readUnit(reader, unitId);
      if (observation?.unitType === 'LENGTHUNIT') return observation;
    }
  }
  return null;
}

function readMapConversions(reader: SpfReader): IfcMapConversionObservation[] {
  return reader.getLinesOfType(WebIFC.IFCMAPCONVERSION).map((conversionId) => {
    const conversion = reader.getLine<Record<string, unknown>>(conversionId);
    const targetCrsId = refId(conversion?.['TargetCRS']);
    const targetCrs =
      targetCrsId === null ? null : reader.getLine<Record<string, unknown>>(targetCrsId);
    const mapUnitId = refId(targetCrs?.['MapUnit']);
    return {
      targetCrs:
        targetCrs === null
          ? null
          : {
              name: stringValue(targetCrs['Name']),
              description: stringValue(targetCrs['Description']),
              geodeticDatum: stringValue(targetCrs['GeodeticDatum']),
              verticalDatum: stringValue(targetCrs['VerticalDatum']),
              mapProjection: stringValue(targetCrs['MapProjection']),
              mapZone: stringValue(targetCrs['MapZone']),
              mapUnit: mapUnitId === null ? null : readUnit(reader, mapUnitId),
            },
      eastings: numericValue(conversion?.['Eastings']),
      northings: numericValue(conversion?.['Northings']),
      orthogonalHeight: numericValue(conversion?.['OrthogonalHeight']),
      xAxisAbscissa: numericValue(conversion?.['XAxisAbscissa']),
      xAxisOrdinate: numericValue(conversion?.['XAxisOrdinate']),
      scale: numericValue(conversion?.['Scale']),
    };
  });
}

function readUnit(reader: SpfReader, unitId: number): IfcUnitObservation | null {
  const unit = reader.getLine<Record<string, unknown>>(unitId);
  if (unit === null) return null;
  const type = reader.getLineType(unitId);
  return {
    kind:
      type === WebIFC.IFCSIUNIT
        ? 'SI'
        : type === WebIFC.IFCCONVERSIONBASEDUNIT
          ? 'CONVERSION_BASED'
          : 'UNKNOWN',
    unitType: stringValue(unit['UnitType']),
    prefix: stringValue(unit['Prefix']),
    name: stringValue(unit['Name']),
    metresPerUnit: lengthUnitScale(reader, unitId, new Set<number>()),
  };
}

function lengthUnitScale(reader: SpfReader, unitId: number, seen: Set<number>): number | null {
  if (seen.has(unitId)) return null;
  seen.add(unitId);
  const unit = reader.getLine<Record<string, unknown>>(unitId);
  if (unit === null || stringValue(unit['UnitType']) !== 'LENGTHUNIT') return null;
  const type = reader.getLineType(unitId);
  if (type === WebIFC.IFCSIUNIT) return prefixScale(stringValue(unit['Prefix']));
  if (type !== WebIFC.IFCCONVERSIONBASEDUNIT) return null;
  const factorId = refId(unit['ConversionFactor']);
  if (factorId === null) return null;
  const factor = reader.getLine<Record<string, unknown>>(factorId);
  const value = numericValue(factor?.['ValueComponent']);
  const baseId = refId(factor?.['UnitComponent']);
  if (value === null || baseId === null) return null;
  const baseScale = lengthUnitScale(reader, baseId, seen);
  return baseScale === null ? null : value * baseScale;
}

function prefixScale(prefix: string | null): number | null {
  const scales: Readonly<Record<string, number>> = {
    KILO: 1_000,
    HECTO: 100,
    DECA: 10,
    DECI: 0.1,
    CENTI: 0.01,
    MILLI: 0.001,
    MICRO: 0.000_001,
  };
  return prefix === null ? 1 : (scales[prefix] ?? null);
}

function relationshipEdges(
  reader: SpfReader,
  relationshipType: number,
  parentField: string,
  childrenField: string,
  roots: ReadonlyMap<number, RootRecord>
): string[] {
  const edges: string[] = [];
  for (const relationshipId of reader.getLinesOfType(relationshipType)) {
    const relationship = reader.getLine<Record<string, unknown>>(relationshipId);
    const parentId = refId(relationship?.[parentField]);
    if (parentId === null) continue;
    const parentGuid = roots.get(parentId)?.guid;
    if (parentGuid === undefined) continue;
    for (const childId of refIds(relationship?.[childrenField])) {
      const childGuid = roots.get(childId)?.guid;
      if (childGuid !== undefined) edges.push(`${parentGuid}>${childGuid}`);
    }
  }
  return edges.sort();
}

function compareByGuid(left: { readonly guid: string }, right: { readonly guid: string }): number {
  return left.guid.localeCompare(right.guid);
}

function refId(value: unknown): number | null {
  if (typeof value === 'number') return value;
  const wrapped = (value as { readonly value?: unknown } | null | undefined)?.value;
  return typeof wrapped === 'number' ? wrapped : null;
}

function refIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const id = refId(item);
    return id === null ? [] : [id];
  });
}

function stringValue(value: unknown): string | null {
  if (typeof value === 'string') return value;
  const wrapped = (value as { readonly value?: unknown } | null | undefined)?.value;
  return typeof wrapped === 'string' ? wrapped : null;
}

function numericValue(value: unknown): number | null {
  if (typeof value === 'number') return value;
  const wrapped = (value as { readonly value?: unknown } | null | undefined)?.value;
  return typeof wrapped === 'number' ? wrapped : null;
}
