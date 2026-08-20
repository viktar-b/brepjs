import { csg, type Result, type ShapeMesh } from 'brepjs';
import { evaluateModel, resolve, type ResolvedElement } from 'brepjs-families';
import { buildInfraBridge } from '../../../../examples/infra-bridge/src/main.js';
import type {
  AuthoredOccurrenceNode,
  EvaluatedOccurrenceNode,
} from '../../node/compareEvaluatedOccurrence.js';
import type { AuthoredSnapshot, BackendResult } from './workbenchRuntime.js';

/** Evaluate the complete authored Model and copy plain mesh evidence out of evaluator ownership. */
export async function evaluateAuthoredSnapshot(): Promise<BackendResult<AuthoredSnapshot>> {
  try {
    await import('brepjs/quick');
    const root = resolve(await buildInfraBridge());
    const evaluator = new csg.Evaluator();
    try {
      const evaluated = evaluateModel(root, evaluator);
      const resolvedNodes = new Map<string, AuthoredOccurrenceNode>();
      for (const node of flattenResolved(root)) {
        resolvedNodes.set(node.keyPath, {
          keyPath: node.keyPath,
          localFrame: node.localFrame,
          worldFrame: node.worldFrame,
        });
      }
      const evaluatedNodes = new Map<string, EvaluatedOccurrenceNode>();
      for (const [keyPath, node] of evaluated.byKeyPath) {
        evaluatedNodes.set(keyPath, { mesh: copyMeshResult(node.mesh) });
      }
      return { ok: true, value: { resolvedNodes, evaluatedNodes } };
    } finally {
      evaluator[Symbol.dispose]();
    }
  } catch (cause) {
    return {
      ok: false,
      error: {
        stage: 'authored-evaluation',
        code: 'AUTHORED_MODEL_EVALUATION_FAILED',
        message: cause instanceof Error ? cause.message : 'The complete authored Model failed',
        context: {},
        retryable: true,
        action: 'Inspect the latest TSX edit and repair the reported Model construction failure',
      },
    };
  }
}

function flattenResolved(root: ResolvedElement): readonly ResolvedElement[] {
  return [root, ...root.children.flatMap(flattenResolved)];
}

function copyMeshResult(result: Result<ShapeMesh>): Result<ShapeMesh> {
  if (!result.ok) {
    return {
      ok: false,
      error: {
        kind: result.error.kind,
        code: result.error.code,
        message: result.error.message,
        ...(result.error.suggestion === undefined ? {} : { suggestion: result.error.suggestion }),
      },
    };
  }
  return {
    ok: true,
    value: {
      vertices: new Float32Array(result.value.vertices),
      triangles: new Uint32Array(result.value.triangles),
      normals: new Float32Array(result.value.normals),
      uvs: new Float32Array(result.value.uvs),
      faceGroups: result.value.faceGroups.map((group) => ({ ...group })),
    },
  };
}
