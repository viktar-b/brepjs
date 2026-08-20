import type { MeshData } from 'brepjs-viewer';
import type { DiagnosticSurface, DiagnosticVector } from '../shared/protocol.js';

/** Hydrate one canonical Z-up diagnostic surface into the viewer's Y-up typed mesh arrays. */
export function surfaceToMeshData(surface: DiagnosticSurface, color?: string): MeshData {
  const points = surface.vertices.map(toViewerPoint);
  const position = new Float32Array(points.flat());
  const index = new Uint32Array(surface.triangles.flat());
  const accumulated = Array.from({ length: points.length }, () => [0, 0, 0] as DiagnosticVector);
  const edgeKeys = new Set<string>();
  const edges: number[] = [];

  for (const triangle of surface.triangles) {
    const a = requiredPoint(points, triangle[0]);
    const b = requiredPoint(points, triangle[1]);
    const c = requiredPoint(points, triangle[2]);
    const faceNormal = cross(subtract(b, a), subtract(c, a));
    for (const vertexIndex of triangle) {
      const current = requiredPoint(accumulated, vertexIndex);
      accumulated[vertexIndex] = add(current, faceNormal);
    }
    addEdge(triangle[0], triangle[1], points, edgeKeys, edges);
    addEdge(triangle[1], triangle[2], points, edgeKeys, edges);
    addEdge(triangle[2], triangle[0], points, edgeKeys, edges);
  }

  const normal = new Float32Array(
    accumulated.flatMap((vector) => {
      const magnitude = Math.hypot(...vector);
      return magnitude > 1e-12
        ? [vector[0] / magnitude, vector[1] / magnitude, vector[2] / magnitude]
        : [0, 1, 0];
    })
  );
  return {
    position,
    normal,
    index,
    edges: new Float32Array(edges),
    ...(color === undefined ? {} : { color }),
  };
}

/** Merge visible layers into an immutable mesh used only for shared camera framing. */
export function mergeMeshData(meshes: readonly MeshData[]): MeshData {
  const positionLength = meshes.reduce((total, mesh) => total + mesh.position.length, 0);
  const normalLength = meshes.reduce((total, mesh) => total + mesh.normal.length, 0);
  const indexLength = meshes.reduce((total, mesh) => total + mesh.index.length, 0);
  const edgeLength = meshes.reduce((total, mesh) => total + mesh.edges.length, 0);
  const position = new Float32Array(positionLength);
  const normal = new Float32Array(normalLength);
  const index = new Uint32Array(indexLength);
  const edges = new Float32Array(edgeLength);

  let positionOffset = 0;
  let normalOffset = 0;
  let indexOffset = 0;
  let edgeOffset = 0;
  let vertexOffset = 0;
  for (const mesh of meshes) {
    position.set(mesh.position, positionOffset);
    normal.set(mesh.normal, normalOffset);
    edges.set(mesh.edges, edgeOffset);
    for (let item = 0; item < mesh.index.length; item += 1) {
      index[indexOffset + item] = (mesh.index[item] ?? 0) + vertexOffset;
    }
    positionOffset += mesh.position.length;
    normalOffset += mesh.normal.length;
    indexOffset += mesh.index.length;
    edgeOffset += mesh.edges.length;
    vertexOffset += mesh.position.length / 3;
  }

  return { position, normal, index, edges };
}

function toViewerPoint([x, y, z]: DiagnosticVector): DiagnosticVector {
  return [x, z, y === 0 ? 0 : -y];
}

function addEdge(
  startIndex: number,
  endIndex: number,
  points: readonly DiagnosticVector[],
  seen: Set<string>,
  output: number[]
): void {
  const key =
    startIndex < endIndex
      ? `${startIndex.toString()}:${endIndex.toString()}`
      : `${endIndex.toString()}:${startIndex.toString()}`;
  if (seen.has(key)) return;
  seen.add(key);
  output.push(...requiredPoint(points, startIndex), ...requiredPoint(points, endIndex));
}

function requiredPoint(points: readonly DiagnosticVector[], index: number): DiagnosticVector {
  const point = points[index];
  if (point === undefined) {
    throw new Error(`Diagnostic surface index is out of bounds: ${index.toString()}`);
  }
  return point;
}

function subtract(a: DiagnosticVector, b: DiagnosticVector): DiagnosticVector {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function add(a: DiagnosticVector, b: DiagnosticVector): DiagnosticVector {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function cross(a: DiagnosticVector, b: DiagnosticVector): DiagnosticVector {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
