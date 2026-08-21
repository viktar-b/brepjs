import { err, ok, type Result, type ShapeMesh } from 'brepjs';
import {
  BimModel,
  parseBeamSpec,
  parseBridgePartSpec,
  parseBridgeSpec,
  parseColumnSpec,
  parseEarthworksFillSpec,
  parseFootingSpec,
  parseMemberSpec,
  parseRailingSpec,
  parseSignSpec,
  parseSlabSpec,
  parseWallSpec,
  specError,
  type BimError,
  type LocalId,
  type ProductBody,
} from 'brepjs-bim';
import {
  type EngineeringSemantics,
  type EvaluatedModel,
  type Frame,
  type ResolvedElement,
} from 'brepjs-families';

export interface InfraBridgeProjection {
  readonly model: BimModel;
  readonly idByKeyPath: ReadonlyMap<string, LocalId>;
}

type ParentKind = 'project' | 'site' | 'bridge' | 'bridge-part';

interface ProjectionParent {
  readonly kind: ParentKind;
  readonly localId: LocalId;
}

const productKinds = new Set([
  'member',
  'sign',
  'earthworks-fill',
  'beam',
  'column',
  'slab',
  'wall',
  'footing',
  'railing',
]);

/**
 * Project the authored bridge through the example-owned direct BIM adapter.
 * The adapter remains necessary because familiesToBim cannot yet aggregate a
 * bridge part beneath another bridge part.
 */
export function projectInfraBridge(
  root: ResolvedElement,
  evaluated: EvaluatedModel
): Result<InfraBridgeProjection, BimError> {
  if (root.semantics?.kind !== 'project') {
    return err(specError('INFRA_ROOT_KIND', 'Infra bridge root must declare project semantics'));
  }
  const model = new BimModel();
  const initialized = model.init(
    { name: semanticName(root), projectId: 'infra-bridge' },
    { stableKey: root.keyPath }
  );
  if (!initialized.ok) return initialized;
  const idByKeyPath = new Map<string, LocalId>([[root.keyPath, initialized.value]]);
  const walk = (element: ResolvedElement, parent: ProjectionParent): Result<void, BimError> => {
    const semantics = element.semantics;
    if (semantics === undefined) {
      for (const child of element.children) {
        const projected = walk(child, parent);
        if (!projected.ok) return projected;
      }
      return ok(undefined);
    }
    const kind = semantics.kind;
    const hierarchy = validateHierarchy(kind, parent.kind, element.keyPath);
    if (!hierarchy.ok) return hierarchy;
    let added: Result<LocalId, BimError>;
    if (kind === 'site') {
      added = model.addSite(
        { name: semanticName(element), ...placement(element.localFrame) },
        { stableKey: element.keyPath }
      );
    } else if (kind === 'bridge') {
      const parsed = parseBridgeSpec({
        name: semanticName(element),
        ...placement(element.localFrame),
        predefinedType: semantics.role === 'arched' ? 'ARCHED' : 'GIRDER',
      });
      if (!parsed.ok) return parsed;
      added = model.addBridge(parsed.value, { stableKey: element.keyPath });
    } else if (kind === 'bridge-part') {
      const parsed = parseBridgePartSpec({
        name: semanticName(element),
        ...placement(element.localFrame),
        predefinedType: bridgePartType(semantics.role),
        usageType: facilityUsage(semantics),
      });
      if (!parsed.ok) return parsed;
      added = model.addBridgePart(parsed.value, { stableKey: element.keyPath });
    } else {
      added = addProduct(model, element, semantics, evaluated);
    }
    if (!added.ok) return added;
    idByKeyPath.set(element.keyPath, added.value);
    if (productKinds.has(kind)) model.placeIn(added.value, parent.localId);
    else model.aggregate(parent.localId, added.value);
    const nextParent: ProjectionParent = {
      kind: kind as ParentKind,
      localId: added.value,
    };
    for (const child of element.children) {
      const projected = walk(child, nextParent);
      if (!projected.ok) return projected;
    }
    return ok(undefined);
  };

  for (const child of root.children) {
    const projected = walk(child, { kind: 'project', localId: initialized.value });
    if (!projected.ok) {
      model[Symbol.dispose]();
      return projected;
    }
  }
  return ok({ model, idByKeyPath });
}

function validateHierarchy(
  kind: string,
  parent: ParentKind,
  keyPath: string
): Result<void, BimError> {
  const valid =
    (kind === 'site' && parent === 'project') ||
    (kind === 'bridge' && parent === 'site') ||
    (kind === 'bridge-part' && (parent === 'bridge' || parent === 'bridge-part')) ||
    (productKinds.has(kind) && parent === 'bridge-part');
  return valid
    ? ok(undefined)
    : err(
        specError(
          'INFRA_INVALID_HIERARCHY',
          `Invalid semantic hierarchy at '${keyPath}': '${kind}' under '${parent}'`
        )
      );
}

function addProduct(
  model: BimModel,
  element: ResolvedElement,
  semantics: EngineeringSemantics,
  evaluated: EvaluatedModel
): Result<LocalId, BimError> {
  const material = 'material' in semantics ? semantics.material : undefined;
  if (typeof material !== 'string' || material.trim().length === 0) {
    return err(specError('INFRA_MISSING_MATERIAL', `Missing material at '${element.keyPath}'`));
  }
  const dimensions = semanticDimensions(semantics, element.keyPath);
  if (!dimensions.ok) return dimensions;
  const body = productBody(element, evaluated);
  if (!body.ok) return body;
  const common = {
    name: semanticName(element),
    ...placement(element.localFrame),
    materialName: material,
  };
  const options = { stableKey: element.keyPath, productBody: body.value };
  const { length, width, height } = dimensions.value;
  switch (semantics.kind) {
    case 'member': {
      const parsed = parseMemberSpec({
        ...common,
        length,
        profile: { kind: 'RECTANGULAR', width, height },
        predefinedType: semantics.role === 'arch-segment' ? 'ARCH_SEGMENT' : 'NOTDEFINED',
      });
      return parsed.ok ? model.addMember(parsed.value, options) : parsed;
    }
    case 'sign': {
      const parsed = parseSignSpec({
        ...common,
        length,
        profile: { kind: 'RECTANGULAR', width, height },
        predefinedType: 'MARKER',
      });
      return parsed.ok ? model.addSign(parsed.value, options) : parsed;
    }
    case 'earthworks-fill': {
      const parsed = parseEarthworksFillSpec({
        ...common,
        length,
        profile: { kind: 'RECTANGULAR', width, height },
        predefinedType: 'EMBANKMENT',
      });
      return parsed.ok ? model.addEarthworksFill(parsed.value, options) : parsed;
    }
    case 'beam': {
      const parsed = parseBeamSpec({
        ...common,
        length,
        profile: { kind: 'RECTANGULAR', width, height },
        predefinedType: 'BEAM',
      });
      return parsed.ok ? model.addBeam(parsed.value, options) : parsed;
    }
    case 'column': {
      const parsed = parseColumnSpec({
        ...common,
        height,
        profile: { kind: 'RECTANGULAR', width: length, height: width },
        predefinedType: 'COLUMN',
      });
      return parsed.ok ? model.addColumn(parsed.value, options) : parsed;
    }
    case 'slab': {
      const parsed = parseSlabSpec({
        ...common,
        length,
        width,
        thickness: height,
        predefinedType: 'FLOOR',
      });
      return parsed.ok ? model.addSlab(parsed.value, options) : parsed;
    }
    case 'wall': {
      const parsed = parseWallSpec({ ...common, length, thickness: width, height });
      return parsed.ok ? model.addWall(parsed.value, options) : parsed;
    }
    case 'footing': {
      const parsed = parseFootingSpec({
        ...common,
        length,
        width,
        thickness: height,
        predefinedType: 'PAD_FOOTING',
      });
      return parsed.ok ? model.addFooting(parsed.value, options) : parsed;
    }
    case 'railing': {
      const parsed = parseRailingSpec({
        ...common,
        length,
        thickness: width,
        height,
        predefinedType: 'GUARDRAIL',
      });
      return parsed.ok ? model.addRailing(parsed.value, options) : parsed;
    }
    default:
      return err(
        specError(
          'INFRA_UNSUPPORTED_PRODUCT',
          `Unsupported product semantic '${semantics.kind}' at '${element.keyPath}'`
        )
      );
  }
}

function productBody(
  element: ResolvedElement,
  evaluated: EvaluatedModel
): Result<ProductBody, BimError> {
  const mesh = evaluated.byKeyPath.get(element.keyPath)?.mesh;
  if (mesh === undefined || !mesh.ok) {
    return err(specError('INFRA_MISSING_BODY', `Missing evaluated body at '${element.keyPath}'`));
  }
  return ok({ kind: 'TESSELLATED', mesh: componentLocalMesh(mesh.value, element.worldFrame) });
}

function componentLocalMesh(mesh: ShapeMesh, localFrame: Frame): ShapeMesh {
  const vertices = new Float32Array(mesh.vertices.length);
  const normals = new Float32Array(mesh.normals.length);
  const axisY = cross(localFrame.zAxis, localFrame.xAxis);
  for (let index = 0; index + 2 < mesh.vertices.length; index += 3) {
    const offset: readonly [number, number, number] = [
      (mesh.vertices[index] ?? 0) - localFrame.origin[0],
      (mesh.vertices[index + 1] ?? 0) - localFrame.origin[1],
      (mesh.vertices[index + 2] ?? 0) - localFrame.origin[2],
    ];
    vertices[index] = dot(offset, localFrame.xAxis);
    vertices[index + 1] = dot(offset, axisY);
    vertices[index + 2] = dot(offset, localFrame.zAxis);
  }
  for (let index = 0; index + 2 < mesh.normals.length; index += 3) {
    const normal: readonly [number, number, number] = [
      mesh.normals[index] ?? 0,
      mesh.normals[index + 1] ?? 0,
      mesh.normals[index + 2] ?? 0,
    ];
    normals[index] = dot(normal, localFrame.xAxis);
    normals[index + 1] = dot(normal, axisY);
    normals[index + 2] = dot(normal, localFrame.zAxis);
  }
  return { ...mesh, vertices, normals };
}

function semanticDimensions(
  semantics: EngineeringSemantics,
  keyPath: string
): Result<{ readonly length: number; readonly width: number; readonly height: number }, BimError> {
  const length = positiveProperty(semantics, 'length');
  const width = positiveProperty(semantics, 'width');
  const height = positiveProperty(semantics, 'height');
  return length !== undefined && width !== undefined && height !== undefined
    ? ok({ length, width, height })
    : err(specError('INFRA_MISSING_DIMENSION', `Missing positive dimensions at '${keyPath}'`));
}

function positiveProperty(semantics: EngineeringSemantics, property: string): number | undefined {
  const value = semantics.properties?.[property];
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function semanticName(element: ResolvedElement): string {
  const name = element.semantics?.properties?.['name'];
  return typeof name === 'string' && name.trim().length > 0 ? name : element.keyPath;
}

function placement(frame: Frame) {
  return {
    origin: [...frame.origin] as [number, number, number],
    axisX: [...frame.xAxis] as [number, number, number],
    axisZ: [...frame.zAxis] as [number, number, number],
  };
}

function bridgePartType(role: string | undefined) {
  const types = {
    abutment: 'ABUTMENT',
    deck: 'DECK',
    pier: 'PIER',
    substructure: 'SUBSTRUCTURE',
    superstructure: 'SUPERSTRUCTURE',
    'surface-structure': 'SURFACESTRUCTURE',
  } as const;
  return role === undefined || !(role in types)
    ? ('NOTDEFINED' as const)
    : types[role as keyof typeof types];
}

function facilityUsage(semantics: EngineeringSemantics) {
  const usage = semantics.properties?.['usage'];
  if (usage === 'lateral') return 'LATERAL' as const;
  if (usage === 'longitudinal') return 'LONGITUDINAL' as const;
  if (usage === 'vertical') return 'VERTICAL' as const;
  if (usage === 'region') return 'REGION' as const;
  return 'NOTDEFINED' as const;
}

function dot(
  left: readonly [number, number, number],
  right: readonly [number, number, number]
): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function cross(
  left: readonly [number, number, number],
  right: readonly [number, number, number]
): readonly [number, number, number] {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}
