import { err, ok, type Result, type ShapeMesh } from 'brepjs';
import type { EngineeringSemantics, Frame, ResolvedElement } from 'brepjs-families';
import type { BimError } from './errors/bimError.js';
import { fromBrepError, specError } from './errors/bimError.js';
import type { FamiliesToBimOptions } from './familiesProjection.js';
import { productBodyMeshIsClosed, type ProductBody } from './types/productBody.js';

export interface SelectedProductBody {
  readonly body: ProductBody;
  readonly length: number;
  readonly width: number;
  readonly height: number;
}

type RectangularPrismDatum = 'profile-centered-yz' | 'profile-centered-xy' | 'corner-xyz';

function rectangularPrismDatum(kind: string): RectangularPrismDatum | undefined {
  if (kind === 'member' || kind === 'sign' || kind === 'earthworks-fill' || kind === 'beam') {
    return 'profile-centered-yz';
  }
  if (kind === 'column') return 'profile-centered-xy';
  if (kind === 'slab' || kind === 'wall' || kind === 'footing' || kind === 'railing') {
    return 'corner-xyz';
  }
  return undefined;
}

function numericProperty(semantics: EngineeringSemantics, name: string): number | undefined {
  const value = semantics.properties?.[name];
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function yAxis(frame: Frame): readonly [number, number, number] {
  const [zx, zy, zz] = frame.zAxis;
  const [xx, xy, xz] = frame.xAxis;
  return [zy * xz - zz * xy, zz * xx - zx * xz, zx * xy - zy * xx];
}

function dot(x: number, y: number, z: number, axis: readonly [number, number, number]): number {
  return x * axis[0] + y * axis[1] + z * axis[2];
}

/** Convert evaluateModel's world-space mesh back to the authored component Datum. */
function componentLocalMesh(mesh: ShapeMesh, frame: Frame): ShapeMesh {
  const vertices = new Float32Array(mesh.vertices.length);
  const normals = new Float32Array(mesh.normals.length);
  const axisY = yAxis(frame);
  for (let i = 0; i + 2 < mesh.vertices.length; i += 3) {
    const x = (mesh.vertices[i] ?? 0) - frame.origin[0];
    const y = (mesh.vertices[i + 1] ?? 0) - frame.origin[1];
    const z = (mesh.vertices[i + 2] ?? 0) - frame.origin[2];
    vertices[i] = dot(x, y, z, frame.xAxis);
    vertices[i + 1] = dot(x, y, z, axisY);
    vertices[i + 2] = dot(x, y, z, frame.zAxis);
  }
  for (let i = 0; i + 2 < mesh.normals.length; i += 3) {
    const x = mesh.normals[i] ?? 0;
    const y = mesh.normals[i + 1] ?? 0;
    const z = mesh.normals[i + 2] ?? 0;
    normals[i] = dot(x, y, z, frame.xAxis);
    normals[i + 1] = dot(x, y, z, axisY);
    normals[i + 2] = dot(x, y, z, frame.zAxis);
  }
  return { ...mesh, vertices, normals };
}

function meshEnvelope(mesh: ShapeMesh): Result<readonly [number, number, number], BimError> {
  if (mesh.vertices.length < 3 || mesh.triangles.length < 3) {
    return err(specError('FAMILIES_EMPTY_PRODUCT_BODY', 'evaluated Product Body mesh is empty'));
  }
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i + 2 < mesh.vertices.length; i += 3) {
    const x = mesh.vertices[i] ?? 0;
    const y = mesh.vertices[i + 1] ?? 0;
    const z = mesh.vertices[i + 2] ?? 0;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }
  const dimensions: readonly [number, number, number] = [maxX - minX, maxY - minY, maxZ - minZ];
  return dimensions.every((value) => Number.isFinite(value) && value > 0)
    ? ok(dimensions)
    : err(specError('FAMILIES_INVALID_PRODUCT_BODY', 'evaluated Product Body has zero extent'));
}

/** Select an exact supported analytic prism, otherwise evaluated authored tessellation. */
export function selectProductBody(
  el: ResolvedElement,
  semantics: EngineeringSemantics,
  options: FamiliesToBimOptions
): Result<SelectedProductBody, BimError> {
  const length = numericProperty(semantics, 'length');
  const width = numericProperty(semantics, 'width');
  const height = numericProperty(semantics, 'height');
  const geometryForm = semantics.properties?.['geometryForm'];
  const expectedDatum = rectangularPrismDatum(semantics.kind);
  const geometryDatum = semantics.properties?.['geometryDatum'];
  if (
    geometryForm === 'rectangular-prism' &&
    length !== undefined &&
    width !== undefined &&
    height !== undefined &&
    expectedDatum !== undefined &&
    geometryDatum === expectedDatum
  ) {
    return ok({ body: { kind: 'ANALYTIC' }, length, width, height });
  }
  if (
    geometryForm === 'rectangular-prism' &&
    (length === undefined || width === undefined || height === undefined)
  ) {
    return err(
      specError(
        'FAMILIES_INVALID_SEMANTIC_PROPERTY',
        `familiesToBim: rectangular prism at '${el.keyPath}' requires positive length, width, and height properties`
      )
    );
  }

  const evaluated = options.evaluatedModel?.byKeyPath.get(el.keyPath);
  if (evaluated === undefined) {
    if (geometryForm === 'rectangular-prism') {
      return err(
        specError(
          'FAMILIES_INVALID_SEMANTIC_PROPERTY',
          `familiesToBim: rectangular prism at '${el.keyPath}' requires geometryDatum '${expectedDatum ?? 'unsupported'}' or evaluated geometry`
        )
      );
    }
    return err(
      specError(
        'FAMILIES_MISSING_PRODUCT_BODY',
        `familiesToBim: semantic '${semantics.kind}' at '${el.keyPath}' has no supported analytic dimensions or evaluated geometry`
      )
    );
  }
  if (!evaluated.mesh.ok) {
    return err(
      fromBrepError(
        evaluated.mesh.error,
        'FAMILIES_PRODUCT_BODY_EVALUATION_FAILED',
        `familiesToBim: evaluated Product Body failed at '${el.keyPath}'`
      )
    );
  }
  const mesh = componentLocalMesh(evaluated.mesh.value, el.worldFrame);
  if (!productBodyMeshIsClosed(mesh)) {
    return err(
      specError(
        'FAMILIES_INVALID_PRODUCT_BODY',
        `familiesToBim: evaluated Product Body at '${el.keyPath}' is not a closed triangle shell`
      )
    );
  }
  const envelope = meshEnvelope(mesh);
  if (!envelope.ok) return envelope;
  return ok({
    body: { kind: 'TESSELLATED', mesh },
    length: envelope.value[0],
    width: envelope.value[1],
    height: envelope.value[2],
  });
}
