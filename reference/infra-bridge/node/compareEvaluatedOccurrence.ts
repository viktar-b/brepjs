import type { Result, ShapeMesh } from 'brepjs';
import type {
  ComparisonCaseError,
  ComparisonCaseErrorCode,
  ComparisonCaseResult,
  ObservedFrame,
  ReconstructionTarget,
  SurfaceObservation,
} from '../src/index.js';
import { compareReconstructionCase } from '../src/index.js';

export interface ReferenceOccurrenceNode {
  readonly targetKey: string;
  readonly localFrame: ObservedFrame;
  readonly worldFrame: ObservedFrame;
}

export interface AuthoredOccurrenceNode {
  readonly keyPath: string;
  readonly localFrame: ObservedFrame;
  readonly worldFrame: ObservedFrame;
}

export interface EvaluatedOccurrenceNode {
  readonly mesh: Result<ShapeMesh>;
}

export interface CompareEvaluatedOccurrenceRequest {
  readonly semanticKey: string;
  readonly targets: ReadonlyMap<string, ReconstructionTarget>;
  readonly referenceScenes: ReadonlyMap<string, ReferenceOccurrenceNode>;
  readonly resolvedNodes: ReadonlyMap<string, AuthoredOccurrenceNode>;
  readonly evaluatedNodes: ReadonlyMap<string, EvaluatedOccurrenceNode>;
}

/** Select one evaluated authored Occurrence and pass plain evidence to the comparison seam. */
export function compareEvaluatedOccurrence(
  request: CompareEvaluatedOccurrenceRequest
): ComparisonCaseResult {
  const target = request.targets.get(request.semanticKey);
  if (target === undefined) {
    return missing(
      request.semanticKey,
      'REFERENCE_TARGET_MISSING',
      'Reference target is missing for the selected Semantic Key',
      'Verify the checksummed manifest maps this product to a decoded Reconstruction Target'
    );
  }
  const reference = request.referenceScenes.get(request.semanticKey);
  if (reference === undefined) {
    return missing(
      request.semanticKey,
      'REFERENCE_SCENE_NODE_MISSING',
      'Reference placement is missing for the selected Semantic Key',
      'Verify the decoded Reference scene contains the mapped product placement'
    );
  }
  if (reference.targetKey !== request.semanticKey) {
    return {
      ok: false,
      error: {
        stage: 'selection',
        code: 'REFERENCE_SCENE_KEY_MISMATCH',
        semanticKey: request.semanticKey,
        message: 'Reference placement is indexed under a different target Semantic Key',
        suggestion: 'Rebuild the exact-key Reference scene index from decoded product target keys',
        context: { actual: reference.targetKey },
      },
    };
  }
  const candidate = request.resolvedNodes.get(request.semanticKey);
  if (candidate === undefined || candidate.keyPath !== request.semanticKey) {
    return missing(
      request.semanticKey,
      'CANDIDATE_OCCURRENCE_MISSING',
      'Authored Occurrence is missing for the selected Semantic Key',
      'Restore the exact keyed Occurrence in the complete authored Model'
    );
  }
  const evaluated = request.evaluatedNodes.get(request.semanticKey);
  if (evaluated === undefined) {
    return missing(
      request.semanticKey,
      'CANDIDATE_MESH_MISSING',
      'Evaluated Candidate mesh is missing for the selected Semantic Key',
      'Ensure the selected authored Occurrence contains materializable geometry'
    );
  }
  if (!evaluated.mesh.ok) {
    const cause = evaluated.mesh.error;
    return {
      ok: false,
      error: {
        stage: 'evaluation',
        code: 'CANDIDATE_EVALUATION_FAILED',
        semanticKey: request.semanticKey,
        message: 'The selected authored Occurrence failed geometry evaluation',
        suggestion: cause.suggestion ?? 'Repair the Candidate Family operation reported below',
        context: { kind: cause.kind },
        cause: { code: cause.code, message: cause.message },
      },
    };
  }
  const surface = surfaceFromShapeMesh(evaluated.mesh.value);
  if (surface === null) {
    return {
      ok: false,
      error: {
        stage: 'evaluation',
        code: 'INVALID_CANDIDATE_MESH',
        semanticKey: request.semanticKey,
        message: 'The evaluated Candidate mesh contains malformed flat buffers',
        suggestion: 'Inspect the Candidate evaluation result for incomplete vertices or triangles',
        context: {
          vertexValues: evaluated.mesh.value.vertices.length,
          triangleValues: evaluated.mesh.value.triangles.length,
        },
      },
    };
  }
  return compareReconstructionCase({
    semanticKey: request.semanticKey,
    reference: {
      target,
      localFrame: reference.localFrame,
      worldFrame: reference.worldFrame,
    },
    candidate: {
      semanticKey: request.semanticKey,
      localFrame: candidate.localFrame,
      worldFrame: candidate.worldFrame,
      surfaceInWorld: surface,
    },
  });
}

function surfaceFromShapeMesh(mesh: ShapeMesh): SurfaceObservation | null {
  if (mesh.vertices.length % 3 !== 0 || mesh.triangles.length % 3 !== 0) return null;
  const vertices: [number, number, number][] = [];
  for (let index = 0; index < mesh.vertices.length; index += 3) {
    const x = mesh.vertices[index];
    const y = mesh.vertices[index + 1];
    const z = mesh.vertices[index + 2];
    if (x === undefined || y === undefined || z === undefined) return null;
    vertices.push([x, y, z]);
  }
  const triangles: [number, number, number][] = [];
  for (let index = 0; index < mesh.triangles.length; index += 3) {
    const a = mesh.triangles[index];
    const b = mesh.triangles[index + 1];
    const c = mesh.triangles[index + 2];
    if (a === undefined || b === undefined || c === undefined) return null;
    triangles.push([a, b, c]);
  }
  return { unit: 'millimetre', vertices, triangles, closed: true };
}

function missing(
  semanticKey: string,
  code: ComparisonCaseErrorCode,
  message: string,
  suggestion: string
): { readonly ok: false; readonly error: ComparisonCaseError } {
  return {
    ok: false,
    error: {
      stage: 'selection',
      code,
      semanticKey,
      message,
      suggestion,
      context: {},
    },
  };
}
