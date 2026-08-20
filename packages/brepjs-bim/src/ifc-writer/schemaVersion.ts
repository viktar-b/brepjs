/**
 * IFC schema-version abstraction for the writer.
 *
 * The writer targets a single IFC schema per model. This module is the single
 * source of truth for which schemas are supported, the FILE_SCHEMA token that
 * goes into the STEP header, web-ifc's runtime selector, and
 * a guard helper for entities that exist only in a given schema.
 *
 * Selection is wired in by the writer integrator via `BimModelMeta.ifcSchema`;
 * the default is {@link DEFAULT_IFC_SCHEMA}.
 */

/** Writer-supported IFC schemas, in declared order. */
export const IFC_SCHEMAS = ['IFC4', 'IFC4X3', 'IFC4X3_ADD2'] as const;

/** Union of writer-supported IFC schema identifiers. */
export type IfcSchema = (typeof IFC_SCHEMAS)[number];

/** Schema used when none is specified in model meta. */
export const DEFAULT_IFC_SCHEMA: IfcSchema = 'IFC4';

/** Exact Reference View identifier used by the IFC4X3_ADD2 Bridge lane. */
export const IFC4X3_ADD2_REFERENCE_VIEW = 'ReferenceView';

/**
 * The FILE_SCHEMA token for the STEP header.
 *
 * The STEP serializer emits `FILE_SCHEMA(('<token>'));`. For the supported set the token equals the
 * schema identifier itself, but callers should route through this function so a
 * future schema whose header token diverges from its identifier stays correct.
 */
export function fileSchemaString(schema: IfcSchema): string {
  return schema;
}

/** Exact schema selector passed to web-ifc's per-model runtime. */
export function webIfcSchemaString(schema: IfcSchema): string {
  return schema;
}

/** Minimal schema/view provenance exposed by authored and imported IFC models. */
export interface IfcSchemaProvenance {
  readonly schema: string;
  readonly viewDefinition: string | null;
}

/** Whether provenance satisfies the exact IFC4X3_ADD2 Reference View lane. */
export function isIfc4x3Add2ReferenceView(provenance: IfcSchemaProvenance): boolean {
  return (
    provenance.schema === 'IFC4X3_ADD2' && provenance.viewDefinition === IFC4X3_ADD2_REFERENCE_VIEW
  );
}

/** Type guard narrowing an unknown value to a supported {@link IfcSchema}. */
export function isIfcSchema(value: unknown): value is IfcSchema {
  return typeof value === 'string' && (IFC_SCHEMAS as readonly string[]).includes(value);
}

/**
 * Entity names that are valid only in IFC4X3 (a non-exhaustive, additive set of
 * linear-infrastructure entities). Entities absent from every per-schema set are
 * treated as schema-agnostic and supported everywhere (open-world default).
 */
const IFC4X3_ONLY_ENTITIES: ReadonlySet<string> = new Set([
  'IfcAlignment',
  'IfcAlignmentHorizontal',
  'IfcAlignmentVertical',
  'IfcAlignmentCant',
  'IfcAlignmentSegment',
  'IfcLinearElement',
  'IfcReferent',
  'IfcRoad',
  'IfcRailway',
  'IfcBridge',
  'IfcBridgePart',
  'IfcSign',
  'IfcEarthworksFill',
  'IfcMarineFacility',
]);

/**
 * Whether `entityName` may be written in `schema`.
 *
 * Used by entity writers to gate emission of schema-specific entities: an
 * IFC4X3-only entity must not be written into an IFC4 model. Unknown entity
 * names default to supported so the guard never blocks schema-agnostic writes.
 */
export function schemaSupports(schema: IfcSchema, entityName: string): boolean {
  if (IFC4X3_ONLY_ENTITIES.has(entityName)) {
    return schema === 'IFC4X3' || schema === 'IFC4X3_ADD2';
  }
  return true;
}
