import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { csg, exportGlb, type ShapeMesh } from 'brepjs';
import { evaluateModel, resolve, type ResolvedElement } from 'brepjs-families';
import { buildInfraBridge } from './main.js';

await import('brepjs/quick');

const root = resolve(await buildInfraBridge());
using evaluator = new csg.Evaluator();
const evaluated = evaluateModel(root, evaluator);
const evaluatedProducts = [...evaluated.byKeyPath.values()];
const products = evaluatedProducts.map((node) => ({
  keyPath: node.keyPath,
  triangleCount: node.mesh.ok ? node.mesh.value.triangles.length / 3 : 0,
  status: node.mesh.ok ? 'ok' : node.mesh.error.code,
}));
const here = dirname(fileURLToPath(import.meta.url));
const reportOutput = resolvePath(here, '../dist/preview.json');
const glbOutput = resolvePath(here, '../dist/preview.glb');
const isometricOutput = resolvePath(here, '../dist/previewIsometric.svg');
const planOutput = resolvePath(here, '../dist/previewPlan.svg');
const elevationOutput = resolvePath(here, '../dist/previewElevation.svg');
await mkdir(dirname(reportOutput), { recursive: true });
await writeFile(reportOutput, `${JSON.stringify({ products }, null, 2)}\n`);
const meshes = evaluatedProducts.flatMap(({ mesh }) => (mesh.ok ? [mesh.value] : []));
await writeFile(glbOutput, new Uint8Array(exportGlb(mergeMeshes(meshes))));
const resolvedByKey = indexResolved(root);
const renderEntries = evaluatedProducts.flatMap(({ keyPath, mesh }) =>
  mesh.ok ? [{ mesh: mesh.value, node: resolvedByKey.get(keyPath) }] : []
);
await Promise.all([
  writeFile(
    isometricOutput,
    renderSnapshot(renderEntries, 'Isometric', [0.7071, -0.7071, 0], [-0.4082, -0.4082, 0.8165])
  ),
  writeFile(planOutput, renderSnapshot(renderEntries, 'Plan', [1, 0, 0], [0, 1, 0])),
  writeFile(elevationOutput, renderSnapshot(renderEntries, 'Elevation', [1, 0, 0], [0, 0, 1])),
]);
console.warn(`Wrote ${reportOutput}, ${glbOutput}, and three SVG snapshots`);

function mergeMeshes(meshes: readonly ShapeMesh[]): ShapeMesh {
  const vertexCount = meshes.reduce((sum, mesh) => sum + mesh.vertices.length, 0);
  const triangleCount = meshes.reduce((sum, mesh) => sum + mesh.triangles.length, 0);
  const normalCount = meshes.reduce((sum, mesh) => sum + mesh.normals.length, 0);
  const vertices = new Float32Array(vertexCount);
  const triangles = new Uint32Array(triangleCount);
  const normals = new Float32Array(normalCount);
  const faceGroups: ShapeMesh['faceGroups'] = [];
  let vertexOffset = 0;
  let triangleOffset = 0;
  let normalOffset = 0;
  let faceIdOffset = 0;
  for (const mesh of meshes) {
    vertices.set(mesh.vertices, vertexOffset * 3);
    normals.set(mesh.normals, normalOffset);
    for (let index = 0; index < mesh.triangles.length; index++) {
      const triangle = mesh.triangles[index];
      if (triangle === undefined) throw new Error('Malformed preview mesh index');
      triangles[triangleOffset + index] = triangle + vertexOffset;
    }
    for (const group of mesh.faceGroups) {
      faceGroups.push({
        start: group.start + triangleOffset,
        count: group.count,
        faceId: group.faceId + faceIdOffset,
        origin: group.origin,
      });
    }
    vertexOffset += mesh.vertices.length / 3;
    triangleOffset += mesh.triangles.length;
    normalOffset += mesh.normals.length;
    faceIdOffset += mesh.faceGroups.length + 1;
  }
  return { vertices, triangles, normals, uvs: new Float32Array(), faceGroups };
}

interface RenderEntry {
  readonly mesh: ShapeMesh;
  readonly node: ResolvedElement | undefined;
}

interface ProjectedTriangle {
  readonly points: readonly [
    readonly [number, number],
    readonly [number, number],
    readonly [number, number],
  ];
  readonly depth: number;
  readonly color: string;
}

function renderSnapshot(
  entries: readonly RenderEntry[],
  viewName: string,
  right: readonly [number, number, number],
  up: readonly [number, number, number]
): string {
  const depthAxis = cross(right, up);
  const light = normalized([-0.3, -0.4, 1]);
  const triangles: ProjectedTriangle[] = [];
  for (const { mesh, node } of entries) {
    const baseColor = colorFor(node?.semantics?.kind);
    for (let index = 0; index < mesh.triangles.length; index += 3) {
      const a = meshPoint(mesh, mesh.triangles[index]);
      const b = meshPoint(mesh, mesh.triangles[index + 1]);
      const c = meshPoint(mesh, mesh.triangles[index + 2]);
      if (a === undefined || b === undefined || c === undefined) continue;
      const normal = normalized(cross(subtract(b, a), subtract(c, a)));
      const shade = 0.58 + 0.42 * Math.abs(dot(normal, light));
      triangles.push({
        points: [project(a, right, up), project(b, right, up), project(c, right, up)],
        depth: (dot(a, depthAxis) + dot(b, depthAxis) + dot(c, depthAxis)) / 3,
        color: shadeColor(baseColor, shade),
      });
    }
  }
  triangles.sort((left, rightTriangle) => left.depth - rightTriangle.depth);
  const projectedPoints = triangles.flatMap(({ points }) => points);
  const xMin = Math.min(...projectedPoints.map(([x]) => x));
  const xMax = Math.max(...projectedPoints.map(([x]) => x));
  const yMin = Math.min(...projectedPoints.map(([, y]) => y));
  const yMax = Math.max(...projectedPoints.map(([, y]) => y));
  const width = 1_600;
  const height = 1_000;
  const margin = 56;
  const scale = Math.min(
    (width - margin * 2) / (xMax - xMin),
    (height - margin * 2) / (yMax - yMin)
  );
  const offsetX = (width - (xMax - xMin) * scale) / 2 - xMin * scale;
  const offsetY = (height - (yMax - yMin) * scale) / 2 + yMax * scale;
  const polygons = triangles
    .map(({ points, color }) => {
      const coordinates = points
        .map(([x, y]) => `${(x * scale + offsetX).toFixed(2)},${(offsetY - y * scale).toFixed(2)}`)
        .join(' ');
      return `<polygon points="${coordinates}" fill="${color}" stroke="#152231" stroke-width="0.35"/>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#eef3f7"/><g>${polygons}</g><rect x="24" y="22" width="310" height="48" rx="8" fill="#ffffff" fill-opacity="0.88"/><text x="42" y="53" font-family="system-ui,sans-serif" font-size="22" fill="#17212b">Infra Bridge · ${viewName}</text></svg>\n`;
}

function indexResolved(root: ResolvedElement): ReadonlyMap<string, ResolvedElement> {
  const result = new Map<string, ResolvedElement>();
  const visit = (node: ResolvedElement): void => {
    result.set(node.keyPath, node);
    node.children.forEach(visit);
  };
  visit(root);
  return result;
}

function meshPoint(
  mesh: ShapeMesh,
  vertexIndex: number | undefined
): readonly [number, number, number] | undefined {
  if (vertexIndex === undefined) return undefined;
  const offset = vertexIndex * 3;
  const x = mesh.vertices[offset];
  const y = mesh.vertices[offset + 1];
  const z = mesh.vertices[offset + 2];
  return x === undefined || y === undefined || z === undefined ? undefined : [x, y, z];
}

function project(
  point: readonly [number, number, number],
  right: readonly [number, number, number],
  up: readonly [number, number, number]
): readonly [number, number] {
  return [dot(point, right), dot(point, up)];
}

function colorFor(kind: string | undefined): string {
  const colors: Readonly<Record<string, string>> = {
    beam: '#a87543',
    column: '#82756a',
    'earthworks-fill': '#b99d64',
    footing: '#9da7ad',
    member: '#77675b',
    railing: '#bf874d',
    sign: '#b97634',
    slab: '#8b6d4c',
    wall: '#8c8178',
  };
  return colors[kind ?? ''] ?? '#78909c';
}

function shadeColor(hex: string, shade: number): string {
  const value = Number.parseInt(hex.slice(1), 16);
  const channel = (shift: number) => Math.round(((value >> shift) & 0xff) * shade);
  return `rgb(${channel(16)},${channel(8)},${channel(0)})`;
}

function subtract(
  left: readonly [number, number, number],
  right: readonly [number, number, number]
): readonly [number, number, number] {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
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

function normalized(vector: readonly [number, number, number]): readonly [number, number, number] {
  const length = Math.hypot(...vector);
  return length === 0 ? [0, 0, 1] : [vector[0] / length, vector[1] / length, vector[2] / length];
}
