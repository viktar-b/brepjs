import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  inspectReference,
  loadReference,
  type ObservationVector,
  type ObservedFrame,
  type ReconstructionTarget,
  type ReferenceInspectionProduct,
  type ReferenceManifest,
} from '@brepjs/infra-bridge-reference';

const ifcPath = argumentValue('--ifc');
if (ifcPath === undefined) throw new Error('Usage: npm run report:inventory -- --ifc <path>');

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const bytes = await readFile(isAbsolute(ifcPath) ? ifcPath : resolvePath(repositoryRoot, ifcPath));
const manifest = JSON.parse(
  await readFile(new URL('../referenceManifest.json', import.meta.url), 'utf8')
) as ReferenceManifest;
const [inspection, loaded] = await Promise.all([
  inspectReference(bytes),
  loadReference({ bytes, manifest }),
]);
if (!inspection.ok) throw new Error(`${inspection.error.code}: ${inspection.error.message}`);
if (!loaded.ok) throw new Error(`${loaded.error.code}: ${loaded.error.message}`);

const keyByIdentity = new Map(
  [...manifest.mappings, ...(manifest.spatialMappings ?? [])].map((mapping) => [
    mapping.referenceGlobalId,
    mapping.semanticKey,
  ])
);
const inspectionByIdentity = new Map(
  inspection.value.products.map((product) => [product.referenceGlobalId, product])
);
const targetByKey = new Map(loaded.value.targets.map((target) => [target.semanticKey, target]));
const sceneByKey = new Map(
  loaded.value.scene.roots.flatMap((node) =>
    node.kind === 'product' && node.targetKey !== undefined ? [[node.targetKey, node] as const] : []
  )
);
const scopedProducts = manifest.mappings.map((mapping) => {
  const inspected = required(inspectionByIdentity, mapping.referenceGlobalId, 'inspection product');
  const target = required(targetByKey, mapping.semanticKey, 'reconstruction target');
  const scene = required(sceneByKey, mapping.semanticKey, 'reference scene node');
  return {
    semanticKey: mapping.semanticKey,
    entityType: inspected.entityType,
    ...(inspected.name === undefined ? {} : { name: inspected.name }),
    ...(inspected.material === undefined ? {} : { material: inspected.material }),
    representationItemTypes: inspected.representationItemTypes,
    worldFrame: scene.worldFrame,
    localBoundsMm: boundsOf(target.comparisonSurface.vertices),
    closed: target.comparisonSurface.closed,
    ...(target.comparisonSurface.closed ? { volumeMm3: meshVolume(target) } : {}),
    ...(target.dimensions === undefined ? {} : { dimensions: target.dimensions }),
  };
});
const worldPoints = manifest.mappings.flatMap(({ semanticKey }) => {
  const target = required(targetByKey, semanticKey, 'reconstruction target');
  const scene = required(sceneByKey, semanticKey, 'reference scene node');
  return target.comparisonSurface.vertices.map((point) => localToWorld(point, scene.worldFrame));
});
const spatialTypes = new Set(['IfcSite', 'IfcBridge', 'IfcBridgePart']);
const spatialProducts = inspection.value.products.filter(({ entityType }) =>
  spatialTypes.has(entityType)
);
const representationTypes = countValues(
  scopedProducts.flatMap(({ representationItemTypes }) => representationItemTypes)
);
const selectedIdentities = new Set([
  ...manifest.mappings.map(({ referenceGlobalId }) => referenceGlobalId),
  ...(manifest.spatialMappings ?? []).map(({ referenceGlobalId }) => referenceGlobalId),
]);
const unscopedProducts = inspection.value.products
  .filter(
    (product) =>
      !selectedIdentities.has(product.referenceGlobalId) && !spatialTypes.has(product.entityType)
  )
  .map((product) => ({
    entityType: product.entityType,
    ...(product.name === undefined ? {} : { name: product.name }),
    ...(product.material === undefined ? {} : { material: product.material }),
    representationItemTypes: product.representationItemTypes,
    ...(product.worldFrame === undefined ? {} : { worldFrame: product.worldFrame }),
  }));
const report = {
  source: {
    checksum: inspection.value.checksum,
    schema: inspection.value.schema,
    units: {
      sourceLengthUnitToMillimetres: inspection.value.millimetresPerFileUnit,
      reconstructionUnit: 'millimetre',
    },
  },
  entityCounts: inspection.value.entityCounts,
  spatialHierarchy: {
    projectCount: inspection.value.entityCounts['IfcProject'] ?? 0,
    roots: spatialTree(spatialProducts, keyByIdentity),
  },
  scopedSummary: {
    bridges: inspection.value.entityCounts['IfcBridge'] ?? 0,
    bridgeParts: inspection.value.entityCounts['IfcBridgePart'] ?? 0,
    products: scopedProducts.length,
    unscopedProducts: unscopedProducts.length,
    representationTypes,
    materials: countValues(
      scopedProducts.flatMap(({ material }) => (material === undefined ? [] : [material]))
    ),
    overallBoundsMm: boundsOf(worldPoints),
    repeatedComponents: loaded.value.repetitions ?? [],
  },
  scopedProducts,
  unscopedProducts,
};
const reportUrl = new URL('../tmp/inventoryReport.json', import.meta.url);
await mkdir(new URL('../tmp/', import.meta.url), { recursive: true });
await writeFile(reportUrl, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(
  `${JSON.stringify(
    {
      report: fileURLToPath(reportUrl),
      schema: report.source.schema,
      sourceLengthUnitToMillimetres: report.source.units.sourceLengthUnitToMillimetres,
      bridges: report.scopedSummary.bridges,
      bridgeParts: report.scopedSummary.bridgeParts,
      scopedProducts: report.scopedSummary.products,
      unscopedProducts: report.scopedSummary.unscopedProducts,
      representationTypes: report.scopedSummary.representationTypes,
      materials: report.scopedSummary.materials,
      overallBoundsMm: report.scopedSummary.overallBoundsMm,
      repeatedGroups: report.scopedSummary.repeatedComponents.length,
    },
    null,
    2
  )}\n`
);

function argumentValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index < 0 ? undefined : process.argv[index + 1];
}

function spatialTree(
  products: readonly ReferenceInspectionProduct[],
  keyByIdentity: ReadonlyMap<string, string>
): readonly unknown[] {
  const childrenByParent = new Map<string, ReferenceInspectionProduct[]>();
  const identities = new Set(products.map(({ referenceGlobalId }) => referenceGlobalId));
  const roots: ReferenceInspectionProduct[] = [];
  for (const product of products) {
    const parent = product.parentReferenceGlobalId;
    if (parent === undefined || !identities.has(parent)) roots.push(product);
    else childrenByParent.set(parent, [...(childrenByParent.get(parent) ?? []), product]);
  }
  const node = (product: ReferenceInspectionProduct): unknown => ({
    entityType: product.entityType,
    ...(keyByIdentity.get(product.referenceGlobalId) === undefined
      ? {}
      : { semanticKey: keyByIdentity.get(product.referenceGlobalId) }),
    ...(product.name === undefined ? {} : { name: product.name }),
    ...(product.worldFrame === undefined ? {} : { worldFrame: product.worldFrame }),
    children: (childrenByParent.get(product.referenceGlobalId) ?? []).map(node),
  });
  return roots.map(node);
}

function countValues(values: readonly string[]): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) => left.localeCompare(right))
  );
}

function required<K, V>(map: ReadonlyMap<K, V>, key: K, label: string): V {
  const value = map.get(key);
  if (value === undefined) throw new Error(`Missing ${label}: ${String(key)}`);
  return value;
}

function boundsOf(points: readonly ObservationVector[]) {
  if (points.length === 0) throw new Error('Cannot compute empty source bounds');
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const zs = points.map(([, , z]) => z);
  return {
    xMin: Math.min(...xs),
    xMax: Math.max(...xs),
    yMin: Math.min(...ys),
    yMax: Math.max(...ys),
    zMin: Math.min(...zs),
    zMax: Math.max(...zs),
  };
}

function localToWorld(point: ObservationVector, frame: ObservedFrame): ObservationVector {
  const yAxis = cross(frame.zAxis, frame.xAxis);
  return [
    frame.origin[0] + point[0] * frame.xAxis[0] + point[1] * yAxis[0] + point[2] * frame.zAxis[0],
    frame.origin[1] + point[0] * frame.xAxis[1] + point[1] * yAxis[1] + point[2] * frame.zAxis[1],
    frame.origin[2] + point[0] * frame.xAxis[2] + point[1] * yAxis[2] + point[2] * frame.zAxis[2],
  ];
}

function cross(left: ObservationVector, right: ObservationVector): ObservationVector {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function meshVolume(target: ReconstructionTarget): number {
  const { vertices, triangles } = target.comparisonSurface;
  let signedVolume = 0;
  for (const [aIndex, bIndex, cIndex] of triangles) {
    const a = vertices[aIndex];
    const b = vertices[bIndex];
    const c = vertices[cIndex];
    if (a === undefined || b === undefined || c === undefined) {
      throw new Error(`Malformed target indices: ${target.semanticKey}`);
    }
    signedVolume +=
      (a[0] * (b[1] * c[2] - b[2] * c[1]) -
        a[1] * (b[0] * c[2] - b[2] * c[0]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])) /
      6;
  }
  return Math.abs(signedVolume);
}
