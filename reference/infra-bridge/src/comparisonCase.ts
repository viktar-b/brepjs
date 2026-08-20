import type {
  ObservedFrame,
  ObservationVector,
  ReconstructionTarget,
  SurfaceObservation,
} from './contracts.js';
import { scoreCandidate, type CandidateScore } from './scoring.js';

export interface CandidateOccurrenceObservation {
  readonly semanticKey: string;
  readonly localFrame: ObservedFrame;
  /** Frame already applied to the evaluated world surface by Model resolution. */
  readonly worldFrame: ObservedFrame;
  readonly surfaceInWorld: SurfaceObservation;
}

export interface CompareReconstructionCaseRequest {
  readonly semanticKey: string;
  readonly reference: {
    readonly target: ReconstructionTarget;
    readonly localFrame: ObservedFrame;
    readonly worldFrame: ObservedFrame;
  };
  readonly candidate: CandidateOccurrenceObservation;
}

export type FidelityGateId =
  | 'frame-control-point'
  | 'frame-x-axis'
  | 'frame-z-axis'
  | 'envelope-maximum'
  | 'surface-p95'
  | 'surface-maximum'
  | 'normal-mean'
  | 'volume-relative-error';

export interface FidelityGateEvidence {
  readonly id: FidelityGateId;
  readonly value: number | null;
  readonly threshold: number;
  readonly relation: 'at-most' | 'at-least';
  readonly unit: 'millimetre' | 'degree' | 'ratio';
  readonly status: 'pass' | 'fail' | 'not-applicable' | 'unavailable';
}

export interface ComponentComparisonCase {
  readonly semanticKey: string;
  readonly coordinateSpace: 'canonical-component-local';
  readonly surfaces: {
    readonly reference: SurfaceObservation;
    readonly candidate: SurfaceObservation;
  };
  readonly frames: {
    readonly referenceLocal: ObservedFrame;
    readonly referenceWorld: ObservedFrame;
    readonly canonicalWorld: ObservedFrame;
    readonly candidateLocal: ObservedFrame;
    readonly candidateWorld: ObservedFrame;
  };
  readonly frameDeltas: {
    readonly controlPointDeltaMm: number;
    readonly xAxisDeltaDegrees: number;
    readonly zAxisDeltaDegrees: number;
  };
  readonly score: CandidateScore;
  readonly gates: readonly FidelityGateEvidence[];
  readonly pass: boolean;
}

export type ComparisonCaseErrorStage = 'selection' | 'evaluation' | 'canonicalization' | 'scoring';

export type ComparisonCaseErrorCode =
  | 'SEMANTIC_KEY_MISMATCH'
  | 'REFERENCE_TARGET_MISSING'
  | 'REFERENCE_SCENE_NODE_MISSING'
  | 'REFERENCE_SCENE_KEY_MISMATCH'
  | 'CANDIDATE_OCCURRENCE_MISSING'
  | 'CANDIDATE_MESH_MISSING'
  | 'CANDIDATE_EVALUATION_FAILED'
  | 'INVALID_CANDIDATE_MESH'
  | 'INVALID_FRAME'
  | 'SCORING_FAILED';

type ErrorContextValue = string | number | boolean | null;

export interface ComparisonCaseError {
  readonly stage: ComparisonCaseErrorStage;
  readonly code: ComparisonCaseErrorCode;
  readonly semanticKey: string;
  readonly message: string;
  readonly suggestion: string;
  readonly context: Readonly<Record<string, ErrorContextValue>>;
  readonly cause?:
    | {
        readonly code: string;
        readonly message: string;
        readonly context?: Readonly<Record<string, ErrorContextValue>> | undefined;
      }
    | undefined;
}

export type ComparisonCaseResult =
  | { readonly ok: true; readonly value: ComponentComparisonCase }
  | { readonly ok: false; readonly error: ComparisonCaseError };

type AxisName = 'x' | 'y' | 'z';
type SignedAxis = AxisName | `-${AxisName}`;

interface CanonicalAxes {
  readonly x: SignedAxis;
  readonly z: SignedAxis;
}

interface InvalidFrame {
  readonly source: 'reference' | 'candidate';
  readonly frame: string;
}

/** Compare one reference target and authored Occurrence in canonical component-local space. */
export function compareReconstructionCase(
  request: CompareReconstructionCaseRequest
): ComparisonCaseResult {
  const keyFailure = semanticKeyFailure(request);
  if (keyFailure !== null) return { ok: false, error: keyFailure };

  const invalidFrame = invalidFrameName(request);
  if (invalidFrame !== null) {
    return {
      ok: false,
      error: {
        stage: 'canonicalization',
        code: 'INVALID_FRAME',
        semanticKey: request.semanticKey,
        message: `Comparison cannot use the invalid ${invalidFrame.frame}`,
        suggestion:
          'Repair the occurrence placement so its axes are finite, unit length, and orthogonal',
        context: { source: invalidFrame.source, frame: invalidFrame.frame },
      },
    };
  }

  const canonicalWorld = canonicalFrame(
    request.reference.worldFrame,
    canonicalAxesFor(request.semanticKey)
  );
  const referenceSurface = transformSurface(request.reference.target.comparisonSurface, (point) =>
    worldToLocal(localToWorld(point, request.reference.worldFrame), canonicalWorld)
  );
  const candidateSurface = transformSurface(request.candidate.surfaceInWorld, (point) =>
    worldToLocal(point, request.candidate.worldFrame)
  );
  const scored = scoreCandidate(
    { semanticKey: request.semanticKey, comparisonSurface: referenceSurface },
    candidateSurface
  );
  if (!scored.ok) {
    const source = scored.error.context['source'];
    const failure =
      source === 'reference'
        ? {
            message: 'The canonical Reference surface could not be scored',
            suggestion:
              'Repair or regenerate the selected Reference target before comparing authored geometry',
          }
        : source === 'candidate'
          ? {
              message: 'The canonical Candidate surface could not be scored',
              suggestion:
                'Inspect the selected Candidate topology and repair invalid or open geometry',
            }
          : {
              message: 'The canonical component surfaces could not be scored',
              suggestion:
                'Retry scoring and inspect the Reference Harness diagnostics if the failure repeats',
            };
    return {
      ok: false,
      error: {
        stage: 'scoring',
        code: 'SCORING_FAILED',
        semanticKey: request.semanticKey,
        message: failure.message,
        suggestion: failure.suggestion,
        context: {},
        cause: {
          code: scored.error.code,
          message: scored.error.message,
          context: scored.error.context,
        },
      },
    };
  }

  const frameDeltas = {
    controlPointDeltaMm: distance(request.candidate.worldFrame.origin, canonicalWorld.origin),
    xAxisDeltaDegrees: angleDegrees(request.candidate.worldFrame.xAxis, canonicalWorld.xAxis),
    zAxisDeltaDegrees: angleDegrees(request.candidate.worldFrame.zAxis, canonicalWorld.zAxis),
  };
  const gates = fidelityGates(request.semanticKey, scored.value, frameDeltas);
  return {
    ok: true,
    value: {
      semanticKey: request.semanticKey,
      coordinateSpace: 'canonical-component-local',
      surfaces: { reference: referenceSurface, candidate: candidateSurface },
      frames: {
        referenceLocal: request.reference.localFrame,
        referenceWorld: request.reference.worldFrame,
        canonicalWorld,
        candidateLocal: request.candidate.localFrame,
        candidateWorld: request.candidate.worldFrame,
      },
      frameDeltas,
      score: scored.value,
      gates,
      pass: gates.every(({ status }) => status === 'pass' || status === 'not-applicable'),
    },
  };
}

function semanticKeyFailure(request: CompareReconstructionCaseRequest): ComparisonCaseError | null {
  const mismatched = [
    ['reference', 'Reference target', request.reference.target.semanticKey],
    ['candidate', 'Candidate occurrence', request.candidate.semanticKey],
  ] as const satisfies readonly (readonly ['reference' | 'candidate', string, string])[];
  const mismatch = mismatched.find(([, , semanticKey]) => semanticKey !== request.semanticKey);
  if (mismatch === undefined) return null;
  const [source, label, actual] = mismatch;
  return {
    stage: 'selection',
    code: 'SEMANTIC_KEY_MISMATCH',
    semanticKey: request.semanticKey,
    message: `${label} does not match the requested Semantic Key`,
    suggestion: 'Select Reference and Candidate evidence by the same exact Occurrence key path',
    context: { expected: request.semanticKey, actual, source },
  };
}

function invalidFrameName(request: CompareReconstructionCaseRequest): InvalidFrame | null {
  const frames: readonly [InvalidFrame, ObservedFrame][] = [
    [{ source: 'reference', frame: 'Reference Local Frame' }, request.reference.localFrame],
    [{ source: 'reference', frame: 'Reference world Frame' }, request.reference.worldFrame],
    [{ source: 'candidate', frame: 'Candidate Local Frame' }, request.candidate.localFrame],
    [{ source: 'candidate', frame: 'Candidate world Frame' }, request.candidate.worldFrame],
  ];
  return frames.find(([, frame]) => !isRigidFrame(frame))?.[0] ?? null;
}

function isRigidFrame(frame: ObservedFrame): boolean {
  if (![...frame.origin, ...frame.xAxis, ...frame.zAxis].every(Number.isFinite)) return false;
  const xLength = length(frame.xAxis);
  const zLength = length(frame.zAxis);
  if (Math.abs(xLength - 1) > 1e-3 || Math.abs(zLength - 1) > 1e-3) return false;
  return Math.abs(dot(frame.xAxis, frame.zAxis)) <= 1e-3;
}

function canonicalAxesFor(semanticKey: string): CanonicalAxes | undefined {
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

function canonicalFrame(source: ObservedFrame, axes: CanonicalAxes | undefined): ObservedFrame {
  if (axes === undefined) return source;
  return {
    origin: source.origin,
    xAxis: signedAxis(source, axes.x),
    zAxis: signedAxis(source, axes.z),
  };
}

function signedAxis(frame: ObservedFrame, signedName: SignedAxis): ObservationVector {
  const negative = signedName.startsWith('-');
  const name = (negative ? signedName.slice(1) : signedName) as AxisName;
  const yAxis = cross(frame.zAxis, frame.xAxis);
  const axis = name === 'x' ? frame.xAxis : name === 'y' ? yAxis : frame.zAxis;
  const signed: ObservationVector = negative ? [-axis[0], -axis[1], -axis[2]] : [...axis];
  return [cleanZero(signed[0]), cleanZero(signed[1]), cleanZero(signed[2])];
}

function cleanZero(value: number): number {
  return Math.abs(value) < 1e-12 ? 0 : value;
}

function transformSurface(
  surface: SurfaceObservation,
  transform: (point: ObservationVector) => ObservationVector
): SurfaceObservation {
  return {
    ...surface,
    vertices: surface.vertices.map(
      (point) =>
        transform(point).map((value) => (Math.abs(value) < 1e-12 ? 0 : value)) as [
          number,
          number,
          number,
        ]
    ),
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

function worldToLocal(point: ObservationVector, frame: ObservedFrame): ObservationVector {
  const offset: ObservationVector = [
    point[0] - frame.origin[0],
    point[1] - frame.origin[1],
    point[2] - frame.origin[2],
  ];
  const yAxis = cross(frame.zAxis, frame.xAxis);
  return [dot(offset, frame.xAxis), dot(offset, yAxis), dot(offset, frame.zAxis)];
}

function fidelityGates(
  semanticKey: string,
  score: CandidateScore,
  frame: ComponentComparisonCase['frameDeltas']
): readonly FidelityGateEvidence[] {
  const curvedProfile =
    semanticKey.includes('/filler-') ||
    semanticKey.includes('/arch-segment-') ||
    semanticKey.includes('/spandrel-wall-');
  const volumeError = score.volume?.relativeError ?? null;
  return [
    atMost('frame-control-point', frame.controlPointDeltaMm, 5, 'millimetre'),
    atMost('frame-x-axis', frame.xAxisDeltaDegrees, 0.01, 'degree'),
    atMost('frame-z-axis', frame.zAxisDeltaDegrees, 0.01, 'degree'),
    atMost('envelope-maximum', score.envelope.maximumAbsoluteDeltaMm, 2, 'millimetre'),
    atMost('surface-p95', score.surfaceDistance.p95Mm, 25, 'millimetre'),
    atMost('surface-maximum', score.surfaceDistance.maximumMm, 75, 'millimetre'),
    curvedProfile
      ? atLeast('normal-mean', score.normalAgreement.meanCosine, 0.99, 'ratio')
      : {
          id: 'normal-mean',
          value: score.normalAgreement.meanCosine,
          threshold: 0.99,
          relation: 'at-least',
          unit: 'ratio',
          status: 'not-applicable',
        },
    volumeError === null
      ? {
          id: 'volume-relative-error',
          value: null,
          threshold: 0.02,
          relation: 'at-most',
          unit: 'ratio',
          status: 'unavailable',
        }
      : atMost('volume-relative-error', volumeError, 0.02, 'ratio'),
  ];
}

function atMost(
  id: FidelityGateId,
  value: number,
  threshold: number,
  unit: FidelityGateEvidence['unit']
): FidelityGateEvidence {
  return {
    id,
    value,
    threshold,
    relation: 'at-most',
    unit,
    status: value <= threshold ? 'pass' : 'fail',
  };
}

function atLeast(
  id: FidelityGateId,
  value: number,
  threshold: number,
  unit: FidelityGateEvidence['unit']
): FidelityGateEvidence {
  return {
    id,
    value,
    threshold,
    relation: 'at-least',
    unit,
    status: value >= threshold ? 'pass' : 'fail',
  };
}

function dot(a: readonly number[], b: readonly number[]): number {
  return (a[0] ?? 0) * (b[0] ?? 0) + (a[1] ?? 0) * (b[1] ?? 0) + (a[2] ?? 0) * (b[2] ?? 0);
}

function cross(a: ObservationVector, b: ObservationVector): ObservationVector {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function length(vector: ObservationVector): number {
  return Math.hypot(...vector);
}

function distance(a: ObservationVector, b: ObservationVector): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function angleDegrees(a: ObservationVector, b: ObservationVector): number {
  const denominator = length(a) * length(b);
  const cosine = Math.max(-1, Math.min(1, dot(a, b) / denominator));
  return (Math.acos(cosine) * 180) / Math.PI;
}
