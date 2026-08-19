import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve as resolvePath } from 'node:path';
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
  inspectReference,
  loadReference,
  scoreCandidate,
  type CandidateScore,
  type ReconstructionTarget,
  type ReferenceManifest,
  type ReferenceInspectionProduct,
  type ReferenceProductNode,
  type SurfaceObservation,
} from '@brepjs/infra-bridge-reference';

interface ComparisonCase {
  readonly targetKey: string;
  readonly candidateKey: string;
  readonly canonicalAxes?: {
    readonly x: SignedAxis;
    readonly z: SignedAxis;
  };
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

type AxisName = 'x' | 'y' | 'z';
type SignedAxis = AxisName | `-${AxisName}`;

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
const semanticFidelity = compareSemanticFidelity(
  manifest,
  inspected.value.products,
  projected.idByKeyPath,
  candidateModel,
  candidateImport.elements,
  candidateImport.spatialTree
);
disposeImportedModel(candidateImport);
const comparisons: readonly ComparisonCase[] = loaded.value.targets.map(({ semanticKey }) => {
  const canonicalAxes = canonicalAxesFor(semanticKey);
  return {
    targetKey: semanticKey,
    candidateKey: semanticKey,
    ...(canonicalAxes === undefined ? {} : { canonicalAxes }),
  };
});
const reports = comparisons.map(({ targetKey, candidateKey, canonicalAxes }) => {
  const target = requiredTarget(targets, targetKey);
  const referenceScene = scenes.get(targetKey);
  if (referenceScene === undefined)
    throw new Error(`Reference scene node is missing: ${targetKey}`);
  const candidate = resolvedNodes.get(candidateKey);
  const mesh = evaluated.byKeyPath.get(candidateKey)?.mesh;
  if (candidate === undefined || mesh === undefined || !mesh.ok) {
    throw new Error(`Candidate evaluation failed: ${candidateKey}`);
  }
  const expectedFrame = canonicalFrame(referenceScene.worldFrame, canonicalAxes);
  const canonicalTarget = targetInFrame(target, referenceScene.worldFrame, expectedFrame);
  const scored = scoreCandidate(canonicalTarget, surfaceFromMesh(mesh.value, candidate.worldFrame));
  if (!scored.ok) {
    throw new Error(`${targetKey}: ${scored.error.code}: ${scored.error.message}`);
  }
  const controlPointDeltaMm = distance(candidate.worldFrame.origin, expectedFrame.origin);
  const xAxisDeltaDegrees = angleDegrees(candidate.worldFrame.xAxis, expectedFrame.xAxis);
  const zAxisDeltaDegrees = angleDegrees(candidate.worldFrame.zAxis, expectedFrame.zAxis);
  return {
    targetKey,
    candidateKey,
    controlPointDeltaMm,
    xAxisDeltaDegrees,
    zAxisDeltaDegrees,
    score: scored.value,
    pass: gatePass(
      targetKey,
      scored.value,
      controlPointDeltaMm,
      xAxisDeltaDegrees,
      zAxisDeltaDegrees
    ),
  };
});

const bridgeEnvelopes = compareBridgeEnvelopes(
  comparisons,
  targets,
  scenes,
  resolvedNodes,
  evaluated.byKeyPath
);
const report = {
  comparisons: reports,
  bridgeEnvelopes,
  semanticFidelity,
  pass:
    reports.every(({ pass }) => pass) &&
    bridgeEnvelopes.every(({ pass }) => pass) &&
    semanticFidelity.every(({ pass }) => pass),
};
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

function canonicalAxesFor(semanticKey: string): ComparisonCase['canonicalAxes'] {
  if (semanticKey.endsWith('/bridge-deck')) return { x: 'y', z: 'z' };
  if (semanticKey.includes('/main-girder-01')) return { x: 'z', z: '-y' };
  if (semanticKey.includes('/main-girder-')) return { x: 'z', z: 'y' };
  if (
    semanticKey.includes('/cross-girder') &&
    (semanticKey.includes('/pier-01/') || semanticKey.includes('/pier-03/'))
  ) {
    return { x: 'z', z: '-y' };
  }
  if (semanticKey.includes('/cross-girder')) return { x: 'z', z: 'y' };
  if (semanticKey.includes('/railing-') || semanticKey.endsWith('/approach-slab')) {
    return { x: 'y', z: 'z' };
  }
  if (semanticKey.includes('/name-sign-')) return { x: 'x', z: 'y' };
  return undefined;
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

function surfaceFromMesh(mesh: ShapeMesh, localFrame: Frame): SurfaceObservation {
  const vertices: [number, number, number][] = [];
  for (let index = 0; index < mesh.vertices.length; index += 3) {
    const x = mesh.vertices[index];
    const y = mesh.vertices[index + 1];
    const z = mesh.vertices[index + 2];
    if (x === undefined || y === undefined || z === undefined) {
      throw new Error('Malformed candidate mesh vertex');
    }
    vertices.push(worldToLocal([x, y, z], localFrame));
  }
  const triangles: [number, number, number][] = [];
  for (let index = 0; index < mesh.triangles.length; index += 3) {
    const a = mesh.triangles[index];
    const b = mesh.triangles[index + 1];
    const c = mesh.triangles[index + 2];
    if (a === undefined || b === undefined || c === undefined) {
      throw new Error('Malformed candidate mesh index');
    }
    triangles.push([a, b, c]);
  }
  return { unit: 'millimetre', vertices, triangles, closed: true };
}

function canonicalFrame(source: Frame, axes: ComparisonCase['canonicalAxes']): Frame {
  if (axes === undefined) return source;
  return {
    origin: source.origin,
    xAxis: signedAxis(source, axes.x),
    zAxis: signedAxis(source, axes.z),
  };
}

function signedAxis(frame: Frame, signedName: SignedAxis): [number, number, number] {
  const negative = signedName.startsWith('-');
  const name = (negative ? signedName.slice(1) : signedName) as AxisName;
  const yAxis = cross(frame.zAxis, frame.xAxis);
  const axis = name === 'x' ? frame.xAxis : name === 'y' ? yAxis : frame.zAxis;
  return negative ? [-axis[0], -axis[1], -axis[2]] : [...axis];
}

function targetInFrame(
  target: ReconstructionTarget,
  sourceFrame: Frame,
  canonical: Frame
): ReconstructionTarget {
  return {
    ...target,
    comparisonSurface: {
      ...target.comparisonSurface,
      vertices: target.comparisonSurface.vertices.map((point) =>
        worldToLocal(localToWorld(point, sourceFrame), canonical)
      ),
    },
  };
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

function worldToLocal(
  point: readonly [number, number, number],
  frame: Frame
): [number, number, number] {
  const offset: [number, number, number] = [
    point[0] - frame.origin[0],
    point[1] - frame.origin[1],
    point[2] - frame.origin[2],
  ];
  const yAxis = cross(frame.zAxis, frame.xAxis);
  return [dot(offset, frame.xAxis), dot(offset, yAxis), dot(offset, frame.zAxis)];
}

function dot(a: readonly number[], b: readonly number[]): number {
  return (a[0] ?? 0) * (b[0] ?? 0) + (a[1] ?? 0) * (b[1] ?? 0) + (a[2] ?? 0) * (b[2] ?? 0);
}

function cross(
  a: readonly [number, number, number],
  b: readonly [number, number, number]
): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function distance(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(
    (a[0] ?? 0) - (b[0] ?? 0),
    (a[1] ?? 0) - (b[1] ?? 0),
    (a[2] ?? 0) - (b[2] ?? 0)
  );
}

function angleDegrees(a: readonly number[], b: readonly number[]): number {
  const denominator = Math.hypot(...a) * Math.hypot(...b);
  if (denominator === 0) return Number.POSITIVE_INFINITY;
  const cosine = Math.max(-1, Math.min(1, dot(a, b) / denominator));
  return (Math.acos(cosine) * 180) / Math.PI;
}

function gatePass(
  targetKey: string,
  score: CandidateScore,
  controlPointDeltaMm: number,
  xAxisDeltaDegrees: number,
  zAxisDeltaDegrees: number
): boolean {
  const isCurvedProfile =
    targetKey.includes('/filler-') ||
    targetKey.includes('/arch-segment-') ||
    targetKey.includes('/spandrel-wall-');
  return (
    controlPointDeltaMm <= 5 &&
    xAxisDeltaDegrees <= 0.01 &&
    zAxisDeltaDegrees <= 0.01 &&
    score.envelope.maximumAbsoluteDeltaMm <= 2 &&
    score.surfaceDistance.p95Mm <= 25 &&
    score.surfaceDistance.maximumMm <= 75 &&
    (!isCurvedProfile || score.normalAgreement.meanCosine >= 0.99) &&
    score.volume !== undefined &&
    score.volume.relativeError <= 0.02
  );
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
