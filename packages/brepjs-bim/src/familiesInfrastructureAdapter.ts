import { err, ok, type Result } from 'brepjs';
import type { EngineeringSemantics, Frame, ResolvedElement } from 'brepjs-families';
import type { BimError } from './errors/bimError.js';
import { specError } from './errors/bimError.js';
import {
  requireKeyed,
  type FamiliesBimResult,
  type FamiliesToBimOptions,
} from './familiesProjection.js';
import type { LocalId } from './identity/localId.js';
import { BimModel } from './model/bimModel.js';
import { selectProductBody, type SelectedProductBody } from './productBodyProjection.js';
import {
  parseBridgePartSpec,
  parseBridgeSpec,
  parseEarthworksFillSpec,
  parseMemberSpec,
  parseSignSpec,
  type BridgePartPredefinedType,
  type BridgePredefinedType,
  type FacilityUsageType,
  type MemberPredefinedType,
  type SignPredefinedType,
  type EarthworksFillPredefinedType,
} from './specs/infrastructureSpec.js';
import { parseBeamSpec, type BeamPredefinedType } from './specs/beamSpec.js';
import { parseColumnSpec, type ColumnPredefinedType } from './specs/columnSpec.js';
import { parseSlabSpec, type SlabPredefinedType } from './specs/slabSpec.js';
import { parseWallSpec } from './specs/wallSpec.js';
import { parseFootingSpec, type FootingPredefinedType } from './specs/foundationSpec.js';
import { parseRailingSpec, type RailingPredefinedType } from './specs/railingSpec.js';

type SpatialKind = 'project' | 'site' | 'bridge' | 'bridge-part';

const BRIDGE_ROLE: Readonly<Record<string, BridgePredefinedType>> = {
  arched: 'ARCHED',
  'cable-stayed': 'CABLE_STAYED',
  cantilever: 'CANTILEVER',
  culvert: 'CULVERT',
  framework: 'FRAMEWORK',
  girder: 'GIRDER',
  suspension: 'SUSPENSION',
  truss: 'TRUSS',
};

const BRIDGE_PART_ROLE: Readonly<Record<string, BridgePartPredefinedType>> = {
  abutment: 'ABUTMENT',
  deck: 'DECK',
  'deck-segment': 'DECK_SEGMENT',
  foundation: 'FOUNDATION',
  pier: 'PIER',
  'pier-segment': 'PIER_SEGMENT',
  pylon: 'PYLON',
  substructure: 'SUBSTRUCTURE',
  superstructure: 'SUPERSTRUCTURE',
  'surface-structure': 'SURFACESTRUCTURE',
};

const MEMBER_ROLE: Readonly<Record<string, MemberPredefinedType>> = {
  'arch-segment': 'ARCH_SEGMENT',
  brace: 'BRACE',
  chord: 'CHORD',
  member: 'MEMBER',
  mullion: 'MULLION',
  plate: 'PLATE',
  post: 'POST',
  purlin: 'PURLIN',
  rafter: 'RAFTER',
  'stay-cable': 'STAY_CABLE',
  'stiffening-rib': 'STIFFENING_RIB',
  longitudinal: 'STRINGER',
  stringer: 'STRINGER',
  strut: 'STRUT',
  stud: 'STUD',
  suspender: 'SUSPENDER',
  'suspension-cable': 'SUSPENSION_CABLE',
  tiebar: 'TIEBAR',
};

const SIGN_ROLE: Readonly<Record<string, SignPredefinedType>> = {
  marker: 'MARKER',
  mirror: 'MIRROR',
  pictorial: 'PICTORIAL',
};

const EARTHWORKS_FILL_ROLE: Readonly<Record<string, EarthworksFillPredefinedType>> = {
  backfill: 'BACKFILL',
  counterweight: 'COUNTERWEIGHT',
  embankment: 'EMBANKMENT',
  'slope-fill': 'SLOPEFILL',
  subgrade: 'SUBGRADE',
  'subgrade-bed': 'SUBGRADEBED',
  'transition-section': 'TRANSITIONSECTION',
};

const FACILITY_USAGE: Readonly<Record<string, FacilityUsageType>> = {
  lateral: 'LATERAL',
  longitudinal: 'LONGITUDINAL',
  region: 'REGION',
  vertical: 'VERTICAL',
};

const BEAM_ROLE: Readonly<Record<string, BeamPredefinedType>> = {
  beam: 'BEAM',
  'cross-girder': 'BEAM',
  girder: 'BEAM',
  joist: 'JOIST',
  purlin: 'PURLIN',
  rafter: 'RAFTER',
};

const COLUMN_ROLE: Readonly<Record<string, ColumnPredefinedType>> = {
  column: 'COLUMN',
  'pier-stem': 'COLUMN',
  pilaster: 'PILASTER',
};

const SLAB_ROLE: Readonly<Record<string, SlabPredefinedType>> = {
  deck: 'FLOOR',
  floor: 'FLOOR',
  landing: 'LANDING',
  roof: 'ROOF',
  'base-slab': 'BASESLAB',
};

const FOOTING_ROLE: Readonly<Record<string, FootingPredefinedType>> = {
  pad: 'PAD_FOOTING',
  'pad-footing': 'PAD_FOOTING',
  'pile-cap': 'PILE_CAP',
  strip: 'STRIP_FOOTING',
  'strip-footing': 'STRIP_FOOTING',
};

const RAILING_ROLE: Readonly<Record<string, RailingPredefinedType>> = {
  balustrade: 'BALUSTRADE',
  guardrail: 'GUARDRAIL',
  handrail: 'HANDRAIL',
};

interface ProductProjectionContext {
  readonly element: ResolvedElement;
  readonly semantics: EngineeringSemantics;
  readonly material: string;
  readonly selected: SelectedProductBody;
}

interface ProductRoute {
  add(model: BimModel, context: ProductProjectionContext): Result<LocalId, BimError>;
}

function productOptions(context: ProductProjectionContext) {
  return {
    stableKey: context.element.keyPath,
    productBody: context.selected.body,
  };
}

function sharedPrismaticSpec(context: ProductProjectionContext) {
  return {
    name: semanticName(context.element),
    length: context.selected.length,
    profile: {
      kind: 'RECTANGULAR' as const,
      width: context.selected.width,
      height: context.selected.height,
    },
    ...placement(context.element.localFrame),
    materialName: context.material,
  };
}

const PRODUCT_ROUTES = {
  member: {
    add(model, context) {
      const spec = parseMemberSpec({
        ...sharedPrismaticSpec(context),
        predefinedType: MEMBER_ROLE[context.semantics.role ?? ''] ?? 'NOTDEFINED',
      });
      return spec.ok ? model.addMember(spec.value, productOptions(context)) : spec;
    },
  },
  sign: {
    add(model, context) {
      const spec = parseSignSpec({
        ...sharedPrismaticSpec(context),
        predefinedType: SIGN_ROLE[context.semantics.role ?? ''] ?? 'NOTDEFINED',
      });
      return spec.ok ? model.addSign(spec.value, productOptions(context)) : spec;
    },
  },
  'earthworks-fill': {
    add(model, context) {
      const spec = parseEarthworksFillSpec({
        ...sharedPrismaticSpec(context),
        predefinedType: EARTHWORKS_FILL_ROLE[context.semantics.role ?? ''] ?? 'NOTDEFINED',
      });
      return spec.ok ? model.addEarthworksFill(spec.value, productOptions(context)) : spec;
    },
  },
  beam: {
    add(model, context) {
      const spec = parseBeamSpec({
        ...sharedPrismaticSpec(context),
        predefinedType: BEAM_ROLE[context.semantics.role ?? ''] ?? 'NOTDEFINED',
      });
      return spec.ok ? model.addBeam(spec.value, productOptions(context)) : spec;
    },
  },
  column: {
    add(model, context) {
      const spec = parseColumnSpec({
        name: semanticName(context.element),
        height: context.selected.height,
        profile: {
          kind: 'RECTANGULAR',
          width: context.selected.length,
          height: context.selected.width,
        },
        ...placement(context.element.localFrame),
        materialName: context.material,
        predefinedType: COLUMN_ROLE[context.semantics.role ?? ''] ?? 'NOTDEFINED',
      });
      return spec.ok ? model.addColumn(spec.value, productOptions(context)) : spec;
    },
  },
  slab: {
    add(model, context) {
      const spec = parseSlabSpec({
        name: semanticName(context.element),
        length: context.selected.length,
        width: context.selected.width,
        thickness: context.selected.height,
        ...placement(context.element.localFrame),
        materialName: context.material,
        predefinedType: SLAB_ROLE[context.semantics.role ?? ''] ?? 'FLOOR',
      });
      return spec.ok ? model.addSlab(spec.value, productOptions(context)) : spec;
    },
  },
  wall: {
    add(model, context) {
      const spec = parseWallSpec({
        name: semanticName(context.element),
        length: context.selected.length,
        thickness: context.selected.width,
        height: context.selected.height,
        ...placement(context.element.localFrame),
        materialName: context.material,
      });
      return spec.ok ? model.addWall(spec.value, productOptions(context)) : spec;
    },
  },
  footing: {
    add(model, context) {
      const spec = parseFootingSpec({
        name: semanticName(context.element),
        length: context.selected.length,
        width: context.selected.width,
        thickness: context.selected.height,
        ...placement(context.element.localFrame),
        materialName: context.material,
        predefinedType: FOOTING_ROLE[context.semantics.role ?? ''] ?? 'NOTDEFINED',
      });
      return spec.ok ? model.addFooting(spec.value, productOptions(context)) : spec;
    },
  },
  railing: {
    add(model, context) {
      const spec = parseRailingSpec({
        name: semanticName(context.element),
        length: context.selected.length,
        thickness: context.selected.width,
        height: context.selected.height,
        ...placement(context.element.localFrame),
        materialName: context.material,
        predefinedType: RAILING_ROLE[context.semantics.role ?? ''] ?? 'NOTDEFINED',
      });
      return spec.ok ? model.addRailing(spec.value, productOptions(context)) : spec;
    },
  },
} satisfies Readonly<Record<string, ProductRoute>>;

type ProductKind = keyof typeof PRODUCT_ROUTES;
type CivilKind = SpatialKind | ProductKind;

interface CivilParent {
  readonly kind: CivilKind;
  readonly localId: LocalId;
}

function isProductKind(kind: string): kind is ProductKind {
  return Object.hasOwn(PRODUCT_ROUTES, kind);
}

function isCivilKind(kind: string): kind is Exclude<CivilKind, 'project'> {
  return kind === 'site' || kind === 'bridge' || kind === 'bridge-part' || isProductKind(kind);
}

function semanticName(el: ResolvedElement): string {
  const value = el.semantics?.properties?.['name'];
  return typeof value === 'string' && value.trim().length > 0 ? value : el.keyPath;
}

function placement(frame: Frame): {
  readonly origin: [number, number, number];
  readonly axisX: [number, number, number];
  readonly axisZ: [number, number, number];
} {
  return {
    origin: [...frame.origin],
    axisX: [...frame.xAxis],
    axisZ: [...frame.zAxis],
  };
}

function expectedParent(kind: Exclude<CivilKind, 'project'>): CivilKind {
  if (kind === 'site') return 'project';
  if (kind === 'bridge') return 'site';
  if (kind === 'bridge-part') return 'bridge';
  return 'bridge-part';
}

/** IFC4X3 civil Projection routed only from definition-owned semantics. */
export function projectInfrastructure(
  root: ResolvedElement,
  options: FamiliesToBimOptions
): Result<FamiliesBimResult, BimError> {
  const rootKey = requireKeyed(root);
  if (!rootKey.ok) return rootKey;
  if (root.semantics?.kind !== 'project') {
    return err(
      specError(
        'FAMILIES_CIVIL_ROOT_KIND',
        `familiesToBim: civil Projection requires root semantic kind 'project' at '${root.keyPath}'`
      )
    );
  }

  const model = new BimModel();
  const projectName = semanticName(root);
  const initResult = model.init(
    { ...options.project, name: projectName === root.keyPath ? options.project.name : projectName },
    { stableKey: root.keyPath }
  );
  if (!initResult.ok) return initResult;

  const idByKeyPath = new Map<string, LocalId>([[root.keyPath, initResult.value]]);
  const walk = (el: ResolvedElement, parent: CivilParent): Result<void, BimError> => {
    const semantics = el.semantics;
    if (semantics === undefined) {
      if (el.geometry.kind !== 'Empty') {
        return err(
          specError(
            'FAMILIES_MISSING_ENGINEERING_SEMANTICS',
            `familiesToBim: civil element '${el.keyPath}' has geometry but no engineering semantic kind`
          )
        );
      }
      for (const child of el.children) {
        const result = walk(child, parent);
        if (!result.ok) return result;
      }
      return ok(undefined);
    }

    const kind = semantics.kind;
    if (!isCivilKind(kind)) {
      return err(
        specError(
          'FAMILIES_UNSUPPORTED_SEMANTIC_KIND',
          `familiesToBim: unsupported civil semantic kind '${kind}' at '${el.keyPath}'`
        )
      );
    }
    if (parent.kind !== expectedParent(kind)) {
      return err(
        specError(
          'FAMILIES_INVALID_CIVIL_HIERARCHY',
          `familiesToBim: semantic kind '${kind}' at '${el.keyPath}' requires parent '${expectedParent(kind)}', found '${parent.kind}'`
        )
      );
    }
    const keyed = requireKeyed(el);
    if (!keyed.ok) return keyed;

    let added: Result<LocalId, BimError>;
    if (kind === 'site') {
      added = model.addSite(
        { name: semanticName(el), ...placement(el.worldFrame) },
        { stableKey: el.keyPath }
      );
    } else if (kind === 'bridge') {
      const spec = parseBridgeSpec({
        name: semanticName(el),
        ...placement(el.localFrame),
        predefinedType: BRIDGE_ROLE[semantics.role ?? ''] ?? 'NOTDEFINED',
      });
      if (!spec.ok) return spec;
      added = model.addBridge(spec.value, { stableKey: el.keyPath });
    } else if (kind === 'bridge-part') {
      const usageProperty = semantics.properties?.['usage'];
      const usage = typeof usageProperty === 'string' ? usageProperty : (semantics.role ?? '');
      const spec = parseBridgePartSpec({
        name: semanticName(el),
        ...placement(el.localFrame),
        usageType: FACILITY_USAGE[usage] ?? 'NOTDEFINED',
        predefinedType: BRIDGE_PART_ROLE[semantics.role ?? ''] ?? 'NOTDEFINED',
      });
      if (!spec.ok) return spec;
      added = model.addBridgePart(spec.value, { stableKey: el.keyPath });
    } else {
      if (typeof semantics.material !== 'string' || semantics.material.trim().length === 0) {
        return err(
          specError(
            'FAMILIES_MISSING_SEMANTIC_MATERIAL',
            `familiesToBim: semantic '${kind}' at '${el.keyPath}' requires material`
          )
        );
      }
      const selectedBody = selectProductBody(el, semantics, options);
      if (!selectedBody.ok) return selectedBody;
      added = PRODUCT_ROUTES[kind].add(model, {
        element: el,
        semantics,
        material: semantics.material,
        selected: selectedBody.value,
      });
    }
    if (!added.ok) return added;

    idByKeyPath.set(el.keyPath, added.value);
    if (isProductKind(kind)) {
      model.placeIn(added.value, parent.localId);
    } else model.aggregate(parent.localId, added.value);

    const nextParent: CivilParent = { kind, localId: added.value };
    for (const child of el.children) {
      const result = walk(child, nextParent);
      if (!result.ok) return result;
    }
    return ok(undefined);
  };

  const projectParent: CivilParent = { kind: 'project', localId: initResult.value };
  for (const child of root.children) {
    const result = walk(child, projectParent);
    if (!result.ok) {
      model[Symbol.dispose]();
      return result;
    }
  }
  return ok({ model, idByKeyPath });
}
