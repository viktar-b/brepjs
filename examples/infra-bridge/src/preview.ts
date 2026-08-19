import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { csg, exportGlb, type ShapeMesh } from 'brepjs';
import { evaluateModel, resolve, type ResolvedElement } from 'brepjs-families';
import { buildInfraBridge } from './main.js';
import { renderSnapshot, SNAPSHOT_VIEWS, type SnapshotEntry } from './snapshotRenderer.js';

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
const snapshotOutputs = [
  resolvePath(here, '../dist/previewIsometric.svg'),
  resolvePath(here, '../dist/previewPlan.svg'),
  resolvePath(here, '../dist/previewElevation.svg'),
];
await mkdir(dirname(reportOutput), { recursive: true });
await writeFile(reportOutput, `${JSON.stringify({ products }, null, 2)}\n`);
const meshes = evaluatedProducts.flatMap(({ mesh }) => (mesh.ok ? [mesh.value] : []));
await writeFile(glbOutput, new Uint8Array(exportGlb(mergeMeshes(meshes))));
const resolvedByKey = indexResolved(root);
const renderEntries = evaluatedProducts.flatMap(({ keyPath, mesh }) =>
  mesh.ok
    ? [
        {
          mesh: mesh.value,
          color: colorFor(resolvedByKey.get(keyPath)?.semantics?.kind),
        } satisfies SnapshotEntry,
      ]
    : []
);
const snapshotWrites = SNAPSHOT_VIEWS.map((view, index) => {
  const output = snapshotOutputs[index];
  if (output === undefined) throw new Error(`Missing output for ${view.name} snapshot`);
  return writeFile(output, renderSnapshot(renderEntries, `Infra Bridge · ${view.name}`, view));
});
await Promise.all(snapshotWrites);
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

function indexResolved(root: ResolvedElement): ReadonlyMap<string, ResolvedElement> {
  const result = new Map<string, ResolvedElement>();
  const visit = (node: ResolvedElement): void => {
    result.set(node.keyPath, node);
    node.children.forEach(visit);
  };
  visit(root);
  return result;
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
