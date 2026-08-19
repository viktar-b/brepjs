import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { csg, type ShapeMesh } from 'brepjs';
import { evaluateModel, resolve, type Frame, type ResolvedElement } from 'brepjs-families';
import { buildInfraBridge } from '../../../examples/infra-bridge/src/main.js';
import {
  loadReference,
  scoreCandidate,
  type CandidateScore,
  type ReconstructionTarget,
  type ReferenceManifest,
  type ReferenceProductNode,
  type SurfaceObservation,
} from '../src/index.js';

interface ComparisonCase {
  readonly targetKey: string;
  readonly candidateKey: string;
  readonly canonicalAxes?: {
    readonly x: SignedAxis;
    readonly z: SignedAxis;
  };
}

type AxisName = 'x' | 'y' | 'z';
type SignedAxis = AxisName | `-${AxisName}`;

const gateThreeComparisons: readonly ComparisonCase[] = [
  {
    targetKey: 'infra-bridge/road-site/road-river-bridge/deck/bridge-deck',
    candidateKey: 'infra-bridge/road-site/road-river-bridge/deck/bridge-deck',
    canonicalAxes: { x: 'y', z: 'z' },
  },
  {
    targetKey: 'infra-bridge/road-site/road-river-bridge/superstructure/main-girder-02',
    candidateKey: 'infra-bridge/road-site/road-river-bridge/deck/main-girder',
    canonicalAxes: { x: 'z', z: 'y' },
  },
  {
    targetKey: 'infra-bridge/road-site/road-river-bridge/substructure/pier-02/cross-girder',
    candidateKey: 'infra-bridge/road-site/road-river-bridge/pier/cross-girder',
    canonicalAxes: { x: 'z', z: 'y' },
  },
  {
    targetKey: 'infra-bridge/road-site/road-river-bridge/substructure/pier-02/pier-stem',
    candidateKey: 'infra-bridge/road-site/road-river-bridge/pier/pier-stem',
  },
  {
    targetKey: 'infra-bridge/road-site/road-river-bridge/substructure/pier-02/footing',
    candidateKey: 'infra-bridge/road-site/road-river-bridge/pier/footing',
  },
];

const ifcPath = argumentValue('--ifc');
if (ifcPath === undefined) throw new Error('Usage: npm run reference:compare -- --ifc <path>');

await import('brepjs/quick');
const manifest = JSON.parse(
  await readFile(new URL('../referenceManifest.json', import.meta.url), 'utf8')
) as ReferenceManifest;
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const loaded = await loadReference({
  bytes: await readFile(isAbsolute(ifcPath) ? ifcPath : resolvePath(repositoryRoot, ifcPath)),
  manifest,
});
if (!loaded.ok) throw new Error(`${loaded.error.code}: ${loaded.error.message}`);

const targets = new Map(loaded.value.targets.map((target) => [target.semanticKey, target]));
const scenes = new Map(
  loaded.value.scene.roots.filter(isTargetProduct).map((node) => [node.targetKey, node])
);
const root = resolve(buildInfraBridge());
const resolvedNodes = indexResolved(root);
using evaluator = new csg.Evaluator();
const evaluated = evaluateModel(root, evaluator);
const reports = gateThreeComparisons.map(({ targetKey, candidateKey, canonicalAxes }) => {
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
  if (!scored.ok) throw new Error(`${scored.error.code}: ${scored.error.message}`);
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
    pass: gatePass(scored.value, controlPointDeltaMm, xAxisDeltaDegrees, zAxisDeltaDegrees),
  };
});

process.stdout.write(
  `${JSON.stringify({ comparisons: reports, pass: reports.every(({ pass }) => pass) }, null, 2)}\n`
);
if (reports.some(({ pass }) => !pass)) process.exitCode = 1;

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
  score: CandidateScore,
  controlPointDeltaMm: number,
  xAxisDeltaDegrees: number,
  zAxisDeltaDegrees: number
): boolean {
  return (
    controlPointDeltaMm <= 5 &&
    xAxisDeltaDegrees <= 0.01 &&
    zAxisDeltaDegrees <= 0.01 &&
    score.envelope.maximumAbsoluteDeltaMm <= 2 &&
    score.surfaceDistance.p95Mm <= 25 &&
    score.surfaceDistance.maximumMm <= 75 &&
    score.normalAgreement.meanCosine >= 0.999 &&
    score.normalAgreement.minimumCosine >= 0.99 &&
    score.volume !== undefined &&
    score.volume.relativeError <= 0.02 &&
    score.closedSolidIoU !== undefined &&
    score.closedSolidIoU.value >= 0.98
  );
}
