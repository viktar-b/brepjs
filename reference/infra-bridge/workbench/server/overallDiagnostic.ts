import {
  isRigidObservedFrame,
  type ObservedFrame,
  type ReconstructionTarget,
  type SurfaceObservation,
} from '../../src/index.js';
import {
  shapeMeshToSurfaceObservation,
  type AuthoredOccurrenceNode,
  type EvaluatedOccurrenceNode,
  type ReferenceOccurrenceNode,
} from '../../node/compareEvaluatedOccurrence.js';
import type {
  DiagnosticSurface,
  DiagnosticTriangle,
  DiagnosticVector,
  OverallDiagnostic,
  WorkbenchDiagnosticError,
} from '../shared/protocol.js';

const NEAR_ZERO_EPSILON = 1e-12;

export interface AssembleOverallDiagnosticRequest {
  readonly semanticKeys: readonly string[];
  readonly targets: ReadonlyMap<string, ReconstructionTarget>;
  readonly referenceScenes: ReadonlyMap<string, ReferenceOccurrenceNode>;
  readonly resolvedNodes: ReadonlyMap<string, AuthoredOccurrenceNode>;
  readonly evaluatedNodes: ReadonlyMap<string, EvaluatedOccurrenceNode>;
}

export type OverallDiagnosticAssembly = Omit<
  OverallDiagnostic,
  'revision' | 'durationMs' | 'computedAt'
>;

export type OverallDiagnosticAssemblyResult =
  | { readonly ok: true; readonly value: OverallDiagnosticAssembly }
  | { readonly ok: false; readonly error: WorkbenchDiagnosticError };

/** Assemble complete Reference and Candidate product surfaces in their common world space. */
export function assembleOverallDiagnostic(
  request: AssembleOverallDiagnosticRequest
): OverallDiagnosticAssemblyResult {
  const reference = emptySurface();
  const candidate = emptySurface();

  for (const semanticKey of request.semanticKeys) {
    const target = request.targets.get(semanticKey);
    if (target === undefined || target.semanticKey !== semanticKey) {
      return referenceFailure(
        semanticKey,
        'REFERENCE_TARGET_MISSING',
        'Reference target is missing for an overall-model product',
        'Verify the checksummed manifest and restart the workbench'
      );
    }
    const scene = request.referenceScenes.get(semanticKey);
    if (scene === undefined) {
      return referenceFailure(
        semanticKey,
        'REFERENCE_SCENE_NODE_MISSING',
        'Reference placement is missing for an overall-model product',
        'Verify the decoded Reference scene and restart the workbench'
      );
    }
    if (scene.targetKey !== semanticKey) {
      return referenceFailure(
        semanticKey,
        'REFERENCE_SCENE_KEY_MISMATCH',
        'Reference placement is indexed under a different Semantic Key',
        'Rebuild the Reference scene index and restart the workbench'
      );
    }
    const referenceFrames: readonly (readonly [string, ObservedFrame])[] = [
      ['Reference Local Frame', scene.localFrame],
      ['Reference world Frame', scene.worldFrame],
    ];
    const invalidReferenceFrame = referenceFrames.find(([, frame]) => !isRigidObservedFrame(frame));
    if (invalidReferenceFrame !== undefined) {
      return referenceFailure(
        semanticKey,
        'INVALID_REFERENCE_FRAME',
        'Reference placement is not a valid rigid Frame',
        'Inspect the decoded Reference placement and restart the workbench',
        { frame: invalidReferenceFrame[0] }
      );
    }
    if (!isValidSurface(target.comparisonSurface)) {
      return referenceFailure(
        semanticKey,
        'INVALID_REFERENCE_GEOMETRY',
        'Reference geometry is empty or malformed for the overall model',
        'Inspect the decoded Reconstruction Target and restart the workbench'
      );
    }

    const resolved = request.resolvedNodes.get(semanticKey);
    if (resolved === undefined || resolved.keyPath !== semanticKey) {
      return authoredFailure(
        semanticKey,
        'CANDIDATE_OCCURRENCE_MISSING',
        'Authored Occurrence is missing from the complete Model',
        'Restore the exact keyed Occurrence, then recompute'
      );
    }
    const candidateFrames: readonly (readonly [string, ObservedFrame])[] = [
      ['Candidate Local Frame', resolved.localFrame],
      ['Candidate world Frame', resolved.worldFrame],
    ];
    const invalidCandidateFrame = candidateFrames.find(([, frame]) => !isRigidObservedFrame(frame));
    if (invalidCandidateFrame !== undefined) {
      return authoredFailure(
        semanticKey,
        'INVALID_CANDIDATE_FRAME',
        'Authored Occurrence placement is not a valid rigid Frame',
        'Repair the Candidate Occurrence placement, then recompute',
        { frame: invalidCandidateFrame[0] }
      );
    }
    const evaluated = request.evaluatedNodes.get(semanticKey);
    if (evaluated === undefined) {
      return authoredFailure(
        semanticKey,
        'CANDIDATE_MESH_MISSING',
        'Evaluated Candidate mesh is missing from the complete Model',
        'Ensure the Occurrence contains materializable geometry, then recompute'
      );
    }
    if (!evaluated.mesh.ok) {
      return authoredFailure(
        semanticKey,
        'CANDIDATE_EVALUATION_FAILED',
        evaluated.mesh.error.message,
        evaluated.mesh.error.suggestion ?? 'Repair the Candidate Family, then recompute',
        { causeCode: evaluated.mesh.error.code }
      );
    }
    const candidateSurface = shapeMeshToSurfaceObservation(evaluated.mesh.value);
    if (candidateSurface === null) {
      return authoredFailure(
        semanticKey,
        'INVALID_CANDIDATE_MESH',
        'The evaluated Candidate contains malformed mesh buffers',
        'Inspect the Candidate evaluation result, then recompute'
      );
    }

    appendSurface(reference, target.comparisonSurface, (point) =>
      localToWorld(point, scene.worldFrame)
    );
    appendSurface(candidate, candidateSurface, (point) => point);
  }

  return {
    ok: true,
    value: {
      coordinateSpace: 'world',
      productCount: request.semanticKeys.length,
      surfaces: {
        reference: completeSurface(reference),
        candidate: completeSurface(candidate),
      },
    },
  };
}

interface MutableSurface {
  readonly vertices: DiagnosticVector[];
  readonly triangles: DiagnosticTriangle[];
}

function emptySurface(): MutableSurface {
  return { vertices: [], triangles: [] };
}

function appendSurface(
  target: MutableSurface,
  source: SurfaceObservation,
  transform: (point: DiagnosticVector) => DiagnosticVector
): void {
  const offset = target.vertices.length;
  target.vertices.push(...source.vertices.map((point) => transform(point)));
  target.triangles.push(
    ...source.triangles.map(
      ([a, b, c]) => [a + offset, b + offset, c + offset] as DiagnosticTriangle
    )
  );
}

function completeSurface(surface: MutableSurface): DiagnosticSurface {
  return {
    unit: 'millimetre',
    vertices: surface.vertices,
    triangles: surface.triangles,
    closed: false,
  };
}

function localToWorld(
  point: DiagnosticVector,
  frame: ReferenceOccurrenceNode['worldFrame']
): DiagnosticVector {
  const yAxis = cross(frame.zAxis, frame.xAxis);
  return [
    snapNearZero(
      frame.origin[0] + point[0] * frame.xAxis[0] + point[1] * yAxis[0] + point[2] * frame.zAxis[0]
    ),
    snapNearZero(
      frame.origin[1] + point[0] * frame.xAxis[1] + point[1] * yAxis[1] + point[2] * frame.zAxis[1]
    ),
    snapNearZero(
      frame.origin[2] + point[0] * frame.xAxis[2] + point[1] * yAxis[2] + point[2] * frame.zAxis[2]
    ),
  ];
}

function cross(a: DiagnosticVector, b: DiagnosticVector): DiagnosticVector {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function snapNearZero(value: number): number {
  return Math.abs(value) < NEAR_ZERO_EPSILON ? 0 : value;
}

function isValidSurface(surface: SurfaceObservation): boolean {
  return (
    surface.vertices.length > 0 &&
    surface.triangles.length > 0 &&
    surface.vertices.every((vertex) => vertex.every(Number.isFinite)) &&
    surface.triangles.every((triangle) =>
      triangle.every(
        (index) => Number.isSafeInteger(index) && index >= 0 && index < surface.vertices.length
      )
    )
  );
}

function referenceFailure(
  semanticKey: string,
  code: string,
  message: string,
  action: string,
  context: Readonly<Record<string, string>> = {}
): { readonly ok: false; readonly error: WorkbenchDiagnosticError } {
  return {
    ok: false,
    error: {
      stage: 'reference-decode',
      code,
      message,
      context: { ...context, semanticKey },
      retryable: false,
      action,
    },
  };
}

function authoredFailure(
  semanticKey: string,
  code: string,
  message: string,
  action: string,
  context: Readonly<Record<string, string>> = {}
): { readonly ok: false; readonly error: WorkbenchDiagnosticError } {
  return {
    ok: false,
    error: {
      stage: code === 'INVALID_CANDIDATE_MESH' ? 'topology' : 'authored-evaluation',
      code,
      message,
      context: { ...context, semanticKey },
      retryable: true,
      action,
    },
  };
}
