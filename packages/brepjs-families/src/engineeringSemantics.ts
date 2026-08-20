export type EngineeringProperty = string | number | boolean;

export type SpatialComposition = 'collection' | 'element' | 'partial';
export type SpatialSubdivision = 'lateral' | 'longitudinal' | 'vertical' | 'regional';

interface CivilSemanticsBase<K extends string> {
  readonly kind: K;
  readonly category: string;
  readonly role: string;
  readonly properties?: Readonly<Record<string, EngineeringProperty>> | undefined;
}

export interface SiteEngineeringSemantics extends CivilSemanticsBase<'site'> {
  readonly composition: SpatialComposition;
}

export interface FacilityEngineeringSemantics extends CivilSemanticsBase<'facility'> {
  readonly composition: SpatialComposition;
}

export interface SpatialPartEngineeringSemantics extends CivilSemanticsBase<'spatial-part'> {
  readonly composition: SpatialComposition;
  readonly subdivision: SpatialSubdivision;
}

export interface ProductEngineeringSemantics extends CivilSemanticsBase<'product'> {
  readonly material: string;
  readonly dimensionsMm: Readonly<Record<string, number>>;
}

export type CivilEngineeringSemantics =
  | SiteEngineeringSemantics
  | FacilityEngineeringSemantics
  | SpatialPartEngineeringSemantics
  | ProductEngineeringSemantics;

/** Compatibility contract for project-defined semantic kinds outside the civil vocabulary. */
export interface CustomEngineeringSemantics {
  readonly kind: string;
  readonly role?: string | undefined;
  readonly material?: string | undefined;
  readonly properties?: Readonly<Record<string, EngineeringProperty>> | undefined;
}

export type EngineeringSemantics = CustomEngineeringSemantics | CivilEngineeringSemantics;

function qualifyPath(context: string | undefined, path: string): string {
  return context === undefined ? path : `${context}.${path}`;
}

function requireNonEmptyString(value: unknown, path: string, context?: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(
      `brepjs-families: invalid civil engineering semantics at '${qualifyPath(context, path)}': expected a non-empty string`
    );
  }
}

function invalid(path: string, expectation: string, context?: string): never {
  throw new Error(
    `brepjs-families: invalid civil engineering semantics at '${qualifyPath(context, path)}': ${expectation}`
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateCivilSemantics(value: unknown, context?: string): void {
  if (!isRecord(value)) invalid('semantics', 'expected an object', context);
  const kind = value['kind'];
  if (!['site', 'facility', 'spatial-part', 'product'].includes(String(kind))) {
    invalid('kind', 'expected site, facility, spatial-part, or product', context);
  }
  const allowedKeys = new Set(
    kind === 'product'
      ? ['kind', 'category', 'role', 'material', 'dimensionsMm', 'properties']
      : kind === 'spatial-part'
        ? ['kind', 'category', 'role', 'composition', 'subdivision', 'properties']
        : ['kind', 'category', 'role', 'composition', 'properties']
  );
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) invalid(key, `not applicable to civil kind '${String(kind)}'`, context);
  }
  requireNonEmptyString(value['category'], 'category', context);
  requireNonEmptyString(value['role'], 'role', context);

  if (kind === 'product') {
    requireNonEmptyString(value['material'], 'material', context);
    const dimensions = value['dimensionsMm'];
    if (!isRecord(dimensions) || Object.keys(dimensions).length === 0) {
      invalid('dimensionsMm', 'expected at least one named millimetre dimension', context);
    }
    for (const [name, dimension] of Object.entries(dimensions)) {
      if (typeof dimension !== 'number' || !Number.isFinite(dimension) || dimension <= 0) {
        invalid(
          `dimensionsMm.${name}`,
          'expected a finite positive millimetre value',
          context
        );
      }
    }
    return;
  }

  if (!['collection', 'element', 'partial'].includes(String(value['composition']))) {
    invalid('composition', 'expected collection, element, or partial', context);
  }
  if (
    kind === 'spatial-part' &&
    !['lateral', 'longitudinal', 'vertical', 'regional'].includes(String(value['subdivision']))
  ) {
    invalid('subdivision', 'expected lateral, longitudinal, vertical, or regional', context);
  }
}

export function validateDefinitionEngineeringSemantics(
  semantics: EngineeringSemantics | undefined,
  definitionKind: 'Model' | 'Assembly' | 'Family',
  name: string
): EngineeringSemantics | undefined {
  if (semantics === undefined) return undefined;
  if (!isRecord(semantics)) {
    throw new Error(
      `brepjs-families: engineering semantics for ${definitionKind.toLowerCase()} '${name}' requires a non-empty string kind`
    );
  }
  const kind = semantics['kind'];
  if (typeof kind !== 'string' || kind.trim().length === 0) {
    throw new Error(
      `brepjs-families: engineering semantics for ${definitionKind.toLowerCase()} '${name}' requires a non-empty string kind`
    );
  }

  const isTypedCivilKind =
    kind === 'facility' ||
    kind === 'spatial-part' ||
    kind === 'product' ||
    (kind === 'site' && ('category' in semantics || 'composition' in semantics));
  if (!isTypedCivilKind) return semantics;

  const context = `${definitionKind.toLowerCase()} '${name}'`;
  validateCivilSemantics(semantics, context);
  if (kind === 'product' && definitionKind !== 'Family') {
    invalid('kind', 'physical products must be declared by a Family', context);
  }
  if (kind !== 'product' && definitionKind !== 'Assembly') {
    invalid('kind', 'Spatial Assemblies must be declared by an Assembly', context);
  }
  return semantics;
}

/**
 * Validate and retain target-independent civil meaning for a definition.
 *
 * Use when declaring Site, Facility, Spatial Part, or physical-product semantics.
 * IFC entity names and enumerations do not belong in this authored contract.
 */
export function civilSemantics(
  semantics: CivilEngineeringSemantics
): CivilEngineeringSemantics {
  validateCivilSemantics(semantics);
  return semantics;
}
