import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { csg, unwrap, type ShapeMesh } from 'brepjs';
import {
  disposeImportedModel,
  fromIfc,
  hasErrors,
  toIfcValidated,
  type BimModel,
  type ImportedElement,
  type ImportedSpatialNode,
  type LocalId,
} from 'brepjs-bim';
import { evaluateModel, resolve, type Frame, type ResolvedElement } from 'brepjs-families';
import { buildInfraBridge } from '../../../examples/infra-bridge/src/main.js';
import { projectInfraBridge } from '../../../examples/infra-bridge/src/projectInfraBridge.js';
import {
  renderMatchedComparison,
  renderSnapshot,
  SNAPSHOT_VIEWS,
  type SnapshotCamera,
  type SnapshotEntry,
} from '../../../examples/infra-bridge/src/snapshotRenderer.js';
import {
  inspectReference,
  loadReference,
  type ReconstructionTarget,
  type ReferenceManifest,
  type ReferenceInspectionProduct,
  type ReferenceProductNode,
} from '@brepjs/infra-bridge-reference';
import { compareEvaluatedOccurrence } from '../node/compareEvaluatedOccurrence.js';
import {
  collectFreshBatchComparisonEvidence,
  type ComparisonReportRow,
} from './comparisonEvidence.js';

interface ComparisonCase {
  readonly targetKey: string;
  readonly candidateKey: string;
}

interface EnvelopeComparison {
  readonly bridgeKey: string;
  readonly deltasMm: Readonly<Record<EnvelopeFace, number>>;
  readonly maximumAbsoluteDeltaMm: number;
  readonly pass: boolean;
}

type EnvelopeFace = 'xMin' | 'xMax' | 'yMin' | 'yMax' | 'zMin' | 'zMax';
type EnvelopeBounds = Readonly<Record<EnvelopeFace, number>>;

interface SemanticFidelityRow {
  readonly semanticKey: string;
  readonly source: {
    readonly entityType: string;
    readonly material: string | undefined;
    readonly parentKey: string | undefined;
  };
  readonly candidate: {
    readonly entityType: string;
    readonly material: string | undefined;
    readonly parentKey: string | undefined;
  };
  readonly pass: boolean;
}

const ifcPath = argumentValue('--ifc');
if (ifcPath === undefined) throw new Error('Usage: npm run reference:compare -- --ifc <path>');

await import('brepjs/quick');
const manifest = JSON.parse(
  await readFile(new URL('../referenceManifest.json', import.meta.url), 'utf8')
) as ReferenceManifest;
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const referenceBytes = await readFile(
  isAbsolute(ifcPath) ? ifcPath : resolvePath(repositoryRoot, ifcPath)
);
const [loaded, inspected] = await Promise.all([
  loadReference({ bytes: referenceBytes, manifest }),
  inspectReference(referenceBytes),
]);
if (!loaded.ok) throw new Error(`${loaded.error.code}: ${loaded.error.message}`);
if (!inspected.ok) throw new Error(`${inspected.error.code}: ${inspected.error.message}`);

const targets = new Map(loaded.value.targets.map((target) => [target.semanticKey, target]));
const scenes = new Map(
  loaded.value.scene.roots.filter(isTargetProduct).map((node) => [node.targetKey, node])
);
const root = resolve(await buildInfraBridge());
const resolvedNodes = indexResolved(root);
using evaluator = new csg.Evaluator();
const evaluated = evaluateModel(root, evaluator);
const projected = unwrap(projectInfraBridge(root, evaluated));
using candidateModel = projected.model;
const candidateExport = unwrap(
  await toIfcValidated(candidateModel, {
    applicationName: 'brepjs infra bridge comparison',
    applicationVersion: '1',
    ifcSchema: 'IFC4X3',
  })
);
if (hasErrors(candidateExport.report)) {
  throw new Error(
    `Candidate IFC validation failed: ${JSON.stringify(candidateExport.report.issues)}`
  );
}
const candidateImport = unwrap(await fromIfc(candidateExport.bytes));
let semanticFidelity: readonly SemanticFidelityRow[];
try {
  semanticFidelity = compareSemanticFidelity(
    manifest,
    inspected.value.products,
    projected.idByKeyPath,
    candidateModel,
    candidateImport.elements,
    candidateImport.spatialTree
  );
} finally {
  disposeImportedModel(candidateImport);
}
const comparisons: readonly ComparisonCase[] = loaded.value.targets.map(({ semanticKey }) => ({
  targetKey: semanticKey,
  candidateKey: semanticKey,
}));
const reports: readonly ComparisonReportRow[] = comparisons.map(({ targetKey, candidateKey }) => {
  const compared = compareEvaluatedOccurrence({
    semanticKey: targetKey,
    targets,
    referenceScenes: scenes,
    resolvedNodes,
    evaluatedNodes: evaluated.byKeyPath,
  });
  if (!compared.ok) {
    throw new Error(`${targetKey}: ${compared.error.code}: ${compared.error.message}`);
  }
  const { frameDeltas, score, pass } = compared.value;
  return {
    targetKey,
    candidateKey,
    ...frameDeltas,
    score,
    pass,
  };
});

const bridgeEnvelopes = compareBridgeEnvelopes(
  comparisons,
  targets,
  scenes,
  resolvedNodes,
  evaluated.byKeyPath
);
const visualEvidence = await writeMatchedVisualEvidence(
  loaded.value.targets,
  scenes,
  evaluated.byKeyPath
);
const report = {
  comparisons: reports,
  bridgeEnvelopes,
  semanticFidelity,
  visualEvidence,
  pass:
    reports.every(({ pass }) => pass) &&
    bridgeEnvelopes.every(({ pass }) => pass) &&
    semanticFidelity.every(({ pass }) => pass),
};
const parityEvidencePath = argumentValue('--parity-evidence');
if (parityEvidencePath !== undefined) {
  const outputPath = isAbsolute(parityEvidencePath)
    ? parityEvidencePath
    : resolvePath(process.cwd(), parityEvidencePath);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    `${JSON.stringify(collectFreshBatchComparisonEvidence(reports, manifest.checksum), null, 2)}\n`
  );
}
const reportUrl = new URL('../tmp/comparisonReport.json', import.meta.url);
await mkdir(new URL('../tmp/', import.meta.url), { recursive: true });
await writeFile(reportUrl, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(
  `${JSON.stringify(
    {
      report: fileURLToPath(reportUrl),
      compared: reports.length,
      passed: reports.filter(({ pass }) => pass).length,
      semanticEvidence: {
        compared: semanticFidelity.length,
        passed: semanticFidelity.filter(({ pass }) => pass).length,
        failures: semanticFidelity.filter(({ pass }) => !pass),
      },
      visualEvidence,
      bridgeEnvelopes,
      failures: reports
        .filter(({ pass }) => !pass)
        .map(({ targetKey, controlPointDeltaMm, xAxisDeltaDegrees, zAxisDeltaDegrees, score }) => ({
          targetKey,
          controlPointDeltaMm,
          xAxisDeltaDegrees,
          zAxisDeltaDegrees,
          envelopeMm: score.envelope.maximumAbsoluteDeltaMm,
          surfaceMaximumMm: score.surfaceDistance.maximumMm,
          surfaceP95Mm: score.surfaceDistance.p95Mm,
          normalMean: score.normalAgreement.meanCosine,
          normalMinimum: score.normalAgreement.minimumCosine,
          volumeRelativeError: score.volume?.relativeError,
          solidIoU: score.closedSolidIoU?.value,
        })),
      pass: report.pass,
    },
    null,
    2
  )}\n`
);
if (!report.pass) process.exitCode = 1;

function argumentValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index < 0 ? undefined : process.argv[index + 1];
}

function isTargetProduct(
  node: unknown
): node is ReferenceProductNode & { readonly targetKey: string } {
  return (
    typeof node === 'object' &&
    node !== null &&
    'kind' in node &&
    node.kind === 'product' &&
    'targetKey' in node &&
    typeof node.targetKey === 'string'
  );
}

function requiredTarget(
  targets: ReadonlyMap<string, ReconstructionTarget>,
  semanticKey: string
): ReconstructionTarget {
  const target = targets.get(semanticKey);
  if (target === undefined) throw new Error(`Reference target is missing: ${semanticKey}`);
  return target;
}

function localToWorld(
  point: readonly [number, number, number],
  frame: Frame
): [number, number, number] {
  const yAxis = cross(frame.zAxis, frame.xAxis);
  return [
    frame.origin[0] + point[0] * frame.xAxis[0] + point[1] * yAxis[0] + point[2] * frame.zAxis[0],
    frame.origin[1] + point[0] * frame.xAxis[1] + point[1] * yAxis[1] + point[2] * frame.zAxis[1],
    frame.origin[2] + point[0] * frame.xAxis[2] + point[1] * yAxis[2] + point[2] * frame.zAxis[2],
  ];
}

function indexResolved(root: ResolvedElement): ReadonlyMap<string, ResolvedElement> {
  const indexed = new Map<string, ResolvedElement>();
  const visit = (node: ResolvedElement): void => {
    indexed.set(node.keyPath, node);
    node.children.forEach(visit);
  };
  visit(root);
  return indexed;
}

function cross(
  a: readonly [number, number, number],
  b: readonly [number, number, number]
): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function compareBridgeEnvelopes(
  comparisons: readonly ComparisonCase[],
  targets: ReadonlyMap<string, ReconstructionTarget>,
  scenes: ReadonlyMap<string, ReferenceProductNode & { readonly targetKey: string }>,
  resolvedNodes: ReadonlyMap<string, ResolvedElement>,
  evaluatedNodes: ReadonlyMap<
    string,
    { readonly mesh: { readonly ok: boolean; readonly value?: ShapeMesh } }
  >
): readonly EnvelopeComparison[] {
  const bridgeKeys = [...new Set(comparisons.map(({ targetKey }) => bridgeKey(targetKey)))];
  return bridgeKeys.map((key) => {
    const targetPoints: [number, number, number][] = [];
    const candidatePoints: [number, number, number][] = [];
    for (const { targetKey, candidateKey } of comparisons) {
      if (bridgeKey(targetKey) !== key) continue;
      const target = requiredTarget(targets, targetKey);
      const scene = scenes.get(targetKey);
      if (scene === undefined) throw new Error(`Reference scene node is missing: ${targetKey}`);
      targetPoints.push(
        ...target.comparisonSurface.vertices.map((point) => localToWorld(point, scene.worldFrame))
      );
      const candidate = resolvedNodes.get(candidateKey);
      const evaluated = evaluatedNodes.get(candidateKey);
      if (
        candidate === undefined ||
        evaluated?.mesh.ok !== true ||
        evaluated.mesh.value === undefined
      ) {
        throw new Error(`Candidate evaluation failed: ${candidateKey}`);
      }
      const mesh = evaluated.mesh.value;
      for (let index = 0; index < mesh.vertices.length; index += 3) {
        const x = mesh.vertices[index];
        const y = mesh.vertices[index + 1];
        const z = mesh.vertices[index + 2];
        if (x === undefined || y === undefined || z === undefined) {
          throw new Error(`Malformed candidate mesh vertex: ${candidateKey}`);
        }
        candidatePoints.push([x, y, z]);
      }
    }
    const targetBounds = boundsOf(targetPoints);
    const candidateBounds = boundsOf(candidatePoints);
    const deltasMm = envelopeFaces((face) => candidateBounds[face] - targetBounds[face]);
    const maximumAbsoluteDeltaMm = Math.max(
      ...Object.values(deltasMm).map((delta) => Math.abs(delta))
    );
    return { bridgeKey: key, deltasMm, maximumAbsoluteDeltaMm, pass: maximumAbsoluteDeltaMm <= 10 };
  });
}

async function writeMatchedVisualEvidence(
  referenceTargets: readonly ReconstructionTarget[],
  referenceScenes: ReadonlyMap<string, ReferenceProductNode & { readonly targetKey: string }>,
  evaluatedNodes: ReadonlyMap<
    string,
    { readonly mesh: { readonly ok: boolean; readonly value?: ShapeMesh } }
  >
): Promise<{
  readonly outputDirectory: string;
  readonly referenceProducts: number;
  readonly outputProducts: number;
  readonly views: Readonly<Record<string, SnapshotCamera>>;
}> {
  const referenceEntries: SnapshotEntry[] = [];
  const outputEntries: SnapshotEntry[] = [];
  for (const target of referenceTargets) {
    const referenceScene = referenceScenes.get(target.semanticKey);
    if (referenceScene === undefined) {
      throw new Error(`Reference scene node is missing: ${target.semanticKey}`);
    }
    const candidate = evaluatedNodes.get(target.semanticKey)?.mesh;
    if (candidate?.ok !== true || candidate.value === undefined) {
      throw new Error(`Candidate evaluation failed: ${target.semanticKey}`);
    }
    referenceEntries.push({
      mesh: targetWorldMesh(target, referenceScene.worldFrame),
      color: '#a87543',
    });
    outputEntries.push({ mesh: candidate.value, color: '#5f7891' });
  }

  const outputDirectory = new URL('../tmp/visual/', import.meta.url);
  await mkdir(outputDirectory, { recursive: true });
  const views: Record<string, SnapshotCamera> = {};
  for (const view of SNAPSHOT_VIEWS) {
    const matched = renderMatchedComparison(referenceEntries, outputEntries, view);
    views[view.key] = matched.camera;
    await Promise.all([
      writeFile(new URL(`${view.key}Comparison.svg`, outputDirectory), matched.svg),
      writeFile(
        new URL(`${view.key}Reference.svg`, outputDirectory),
        renderSnapshot(referenceEntries, `Reference · ${view.name}`, view, matched.camera)
      ),
      writeFile(
        new URL(`${view.key}Output.svg`, outputDirectory),
        renderSnapshot(outputEntries, `Authored output · ${view.name}`, view, matched.camera)
      ),
    ]);
  }
  const evidence = {
    outputDirectory: fileURLToPath(outputDirectory),
    referenceProducts: referenceEntries.length,
    outputProducts: outputEntries.length,
    views,
  };
  await writeFile(
    new URL('matchedCameras.json', outputDirectory),
    `${JSON.stringify(evidence, null, 2)}\n`
  );
  return evidence;
}

function targetWorldMesh(target: ReconstructionTarget, frame: Frame): ShapeMesh {
  const vertices = new Float32Array(target.comparisonSurface.vertices.length * 3);
  for (const [index, point] of target.comparisonSurface.vertices.entries()) {
    vertices.set(localToWorld(point, frame), index * 3);
  }
  const triangles = new Uint32Array(target.comparisonSurface.triangles.length * 3);
  for (const [index, triangle] of target.comparisonSurface.triangles.entries()) {
    triangles.set(triangle, index * 3);
  }
  return {
    vertices,
    triangles,
    normals: new Float32Array(),
    uvs: new Float32Array(),
    faceGroups: [],
  };
}

function bridgeKey(semanticKey: string): string {
  return semanticKey.split('/').slice(0, 3).join('/');
}

function boundsOf(points: readonly (readonly [number, number, number])[]): EnvelopeBounds {
  if (points.length === 0) throw new Error('Cannot compute an empty bridge envelope');
  const xValues = points.map(([x]) => x);
  const yValues = points.map(([, y]) => y);
  const zValues = points.map(([, , z]) => z);
  return {
    xMin: Math.min(...xValues),
    xMax: Math.max(...xValues),
    yMin: Math.min(...yValues),
    yMax: Math.max(...yValues),
    zMin: Math.min(...zValues),
    zMax: Math.max(...zValues),
  };
}

function envelopeFaces(mapper: (face: EnvelopeFace) => number): EnvelopeBounds {
  return {
    xMin: mapper('xMin'),
    xMax: mapper('xMax'),
    yMin: mapper('yMin'),
    yMax: mapper('yMax'),
    zMin: mapper('zMin'),
    zMax: mapper('zMax'),
  };
}

function compareSemanticFidelity(
  manifest: ReferenceManifest,
  inspectedProducts: readonly ReferenceInspectionProduct[],
  candidateIds: ReadonlyMap<string, LocalId>,
  candidateModel: BimModel,
  importedElements: readonly ImportedElement[],
  importedSpatialRoot: ImportedSpatialNode | null
): readonly SemanticFidelityRow[] {
  const referenceKeyByIdentity = new Map(
    [...manifest.mappings, ...(manifest.spatialMappings ?? [])].map((mapping) => [
      mapping.referenceGlobalId,
      mapping.semanticKey,
    ])
  );
  const sourceByIdentity = new Map(
    inspectedProducts.map((product) => [product.referenceGlobalId, product])
  );
  const candidateKeyByGuid = new Map<string, string>();
  for (const [keyPath, localId] of candidateIds) {
    const element = candidateModel.getElement(localId);
    if (element !== null) candidateKeyByGuid.set(element.guid, keyPath);
  }
  const importedByGuid = new Map(importedElements.map((element) => [element.guid, element]));
  const spatialKeyByExpressId = new Map<number, string>();
  if (importedSpatialRoot !== null) {
    for (const node of flattenImportedSpatial(importedSpatialRoot)) {
      const key = candidateKeyByGuid.get(node.guid);
      if (key !== undefined) spatialKeyByExpressId.set(node.expressId, key);
    }
  }

  return manifest.mappings.map((mapping) => {
    const source = sourceByIdentity.get(mapping.referenceGlobalId);
    if (source === undefined) throw new Error(`Source product is missing: ${mapping.semanticKey}`);
    const candidateLocalId = candidateIds.get(mapping.semanticKey);
    if (candidateLocalId === undefined) {
      throw new Error(`Candidate identity is missing: ${mapping.semanticKey}`);
    }
    const candidateGuid = candidateModel.getElement(candidateLocalId)?.guid;
    if (candidateGuid === undefined) {
      throw new Error(`Candidate product is missing: ${mapping.semanticKey}`);
    }
    const candidate = importedByGuid.get(candidateGuid);
    if (candidate === undefined) {
      throw new Error(`Reimported candidate is missing: ${mapping.semanticKey}`);
    }
    const sourceParentKey =
      source.parentReferenceGlobalId === undefined
        ? undefined
        : referenceKeyByIdentity.get(source.parentReferenceGlobalId);
    const candidateParentKey =
      candidate.spatialContainerExpressId === undefined
        ? undefined
        : spatialKeyByExpressId.get(candidate.spatialContainerExpressId);
    const sourceEvidence = {
      entityType: source.entityType,
      material: source.material,
      parentKey: sourceParentKey,
    };
    const candidateEvidence = {
      entityType: ifcEntityType(candidate.category),
      material: candidate.material?.name,
      parentKey: candidateParentKey,
    };
    return {
      semanticKey: mapping.semanticKey,
      source: sourceEvidence,
      candidate: candidateEvidence,
      pass:
        sourceEvidence.entityType === candidateEvidence.entityType &&
        sourceEvidence.material === candidateEvidence.material &&
        sourceEvidence.parentKey === candidateEvidence.parentKey,
    };
  });
}

function flattenImportedSpatial(root: ImportedSpatialNode): readonly ImportedSpatialNode[] {
  return [root, ...root.children.flatMap(flattenImportedSpatial)];
}

function ifcEntityType(category: ImportedElement['category']): string {
  const names: Readonly<Record<ImportedElement['category'], string>> = {
    BEAM: 'IfcBeam',
    COLUMN: 'IfcColumn',
    COVERING: 'IfcCovering',
    CURTAIN_WALL: 'IfcCurtainWall',
    DOOR: 'IfcDoor',
    EARTHWORKS_FILL: 'IfcEarthworksFill',
    ELEMENT_ASSEMBLY: 'IfcElementAssembly',
    FOOTING: 'IfcFooting',
    MEMBER: 'IfcMember',
    OPENING: 'IfcOpeningElement',
    PILE: 'IfcPile',
    PROXY: 'IfcBuildingElementProxy',
    RAILING: 'IfcRailing',
    RAMP: 'IfcRamp',
    ROOF: 'IfcRoof',
    SIGN: 'IfcSign',
    SLAB: 'IfcSlab',
    SPACE: 'IfcSpace',
    STAIR: 'IfcStair',
    WALL: 'IfcWall',
    WINDOW: 'IfcWindow',
  };
  return names[category];
}
