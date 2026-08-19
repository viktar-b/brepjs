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
import {
  parseBridgePartSpec,
  parseBridgeSpec,
  parseMemberSpec,
  type BridgePartPredefinedType,
  type BridgePredefinedType,
  type FacilityUsageType,
  type MemberPredefinedType,
} from './specs/infrastructureSpec.js';

type CivilKind = 'project' | 'site' | 'bridge' | 'bridge-part' | 'member';

interface CivilParent {
  readonly kind: CivilKind;
  readonly localId: LocalId;
}

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

const FACILITY_USAGE: Readonly<Record<string, FacilityUsageType>> = {
  lateral: 'LATERAL',
  longitudinal: 'LONGITUDINAL',
  region: 'REGION',
  vertical: 'VERTICAL',
};

function semanticName(el: ResolvedElement): string {
  const value = el.semantics?.properties?.['name'];
  return typeof value === 'string' && value.trim().length > 0 ? value : el.keyPath;
}

function semanticNumber(
  semantics: EngineeringSemantics,
  property: string,
  keyPath: string
): Result<number, BimError> {
  const value = semantics.properties?.[property];
  if (typeof value === 'number' && Number.isFinite(value)) return ok(value);
  return err(
    specError(
      'FAMILIES_INVALID_SEMANTIC_PROPERTY',
      `familiesToBim: semantic '${semantics.kind}' at '${keyPath}' requires numeric property '${property}'`
    )
  );
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
    if (kind !== 'site' && kind !== 'bridge' && kind !== 'bridge-part' && kind !== 'member') {
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
      const length = semanticNumber(semantics, 'length', el.keyPath);
      if (!length.ok) return length;
      const width = semanticNumber(semantics, 'width', el.keyPath);
      if (!width.ok) return width;
      const height = semanticNumber(semantics, 'height', el.keyPath);
      if (!height.ok) return height;
      if (typeof semantics.material !== 'string' || semantics.material.trim().length === 0) {
        return err(
          specError(
            'FAMILIES_MISSING_SEMANTIC_MATERIAL',
            `familiesToBim: member semantic at '${el.keyPath}' requires material`
          )
        );
      }
      const spec = parseMemberSpec({
        name: semanticName(el),
        length: length.value,
        profile: { kind: 'RECTANGULAR', width: width.value, height: height.value },
        ...placement(el.localFrame),
        predefinedType: MEMBER_ROLE[semantics.role ?? ''] ?? 'NOTDEFINED',
        materialName: semantics.material,
      });
      if (!spec.ok) return spec;
      added = model.addMember(spec.value, { stableKey: el.keyPath });
    }
    if (!added.ok) return added;

    idByKeyPath.set(el.keyPath, added.value);
    if (kind === 'member') model.placeIn(added.value, parent.localId);
    else model.aggregate(parent.localId, added.value);

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
