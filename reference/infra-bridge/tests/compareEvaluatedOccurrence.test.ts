import { describe, expect, it } from 'vitest';
import type { ShapeMesh } from 'brepjs';
import type { ObservedFrame, ReconstructionTarget } from '../src/index.js';
import { compareEvaluatedOccurrence } from '../node/compareEvaluatedOccurrence.js';

const FRAME: ObservedFrame = {
  origin: [0, 0, 0],
  xAxis: [1, 0, 0],
  zAxis: [0, 0, 1],
};
const KEY = 'infra-bridge/synthetic/footing';

describe('evaluated authored Occurrence comparison adapter', () => {
  it('selects exact key paths and converts ShapeMesh arrays for the pure comparison seam', () => {
    const result = compareEvaluatedOccurrence({
      semanticKey: KEY,
      targets: new Map([[KEY, target()]]),
      referenceScenes: new Map([[KEY, { targetKey: KEY, localFrame: FRAME, worldFrame: FRAME }]]),
      resolvedNodes: new Map([[KEY, { keyPath: KEY, localFrame: FRAME, worldFrame: FRAME }]]),
      evaluatedNodes: new Map([[KEY, { mesh: { ok: true, value: shapeMesh() } }]]),
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        semanticKey: KEY,
        surfaces: {
          reference: { vertices: expect.any(Array), triangles: expect.any(Array) },
          candidate: { vertices: expect.any(Array), triangles: expect.any(Array) },
        },
        pass: true,
      },
    });
  });

  it.each([
    ['target', new Map(), scenes(), resolved(), evaluated(), 'REFERENCE_TARGET_MISSING'],
    ['scene', targets(), new Map(), resolved(), evaluated(), 'REFERENCE_SCENE_NODE_MISSING'],
    ['Occurrence', targets(), scenes(), new Map(), evaluated(), 'CANDIDATE_OCCURRENCE_MISSING'],
    ['mesh', targets(), scenes(), resolved(), new Map(), 'CANDIDATE_MESH_MISSING'],
  ])('returns a structured selection failure for a missing %s', (_, t, s, r, e, code) => {
    expect(
      compareEvaluatedOccurrence({
        semanticKey: KEY,
        targets: t,
        referenceScenes: s,
        resolvedNodes: r,
        evaluatedNodes: e,
      })
    ).toMatchObject({ ok: false, error: { code, semanticKey: KEY } });
  });

  it('sanitizes authored evaluation failures', () => {
    const result = compareEvaluatedOccurrence({
      semanticKey: KEY,
      targets: targets(),
      referenceScenes: scenes(),
      resolvedNodes: resolved(),
      evaluatedNodes: new Map([
        [
          KEY,
          {
            mesh: {
              ok: false,
              error: {
                kind: 'KERNEL_OPERATION',
                code: 'BOOLEAN_FAILED',
                message: 'Cut failed',
                suggestion: 'Increase overlap',
                cause: new Error('private cause'),
              },
            },
          },
        ],
      ]),
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        stage: 'evaluation',
        code: 'CANDIDATE_EVALUATION_FAILED',
        cause: { code: 'BOOLEAN_FAILED', message: 'Cut failed' },
      },
    });
    expect(JSON.stringify(result)).not.toContain('private cause');
  });

  it('rejects a Reference scene stored under the wrong target key', () => {
    expect(
      compareEvaluatedOccurrence({
        semanticKey: KEY,
        targets: targets(),
        referenceScenes: new Map([
          [
            KEY,
            { targetKey: 'infra-bridge/synthetic/other', localFrame: FRAME, worldFrame: FRAME },
          ],
        ]),
        resolvedNodes: resolved(),
        evaluatedNodes: evaluated(),
      })
    ).toMatchObject({
      ok: false,
      error: { stage: 'selection', code: 'REFERENCE_SCENE_KEY_MISMATCH' },
    });
  });

  it('rejects malformed flat mesh buffers before scoring', () => {
    const malformed = { ...shapeMesh(), vertices: new Float32Array([0, 1]) };
    expect(
      compareEvaluatedOccurrence({
        semanticKey: KEY,
        targets: targets(),
        referenceScenes: scenes(),
        resolvedNodes: resolved(),
        evaluatedNodes: new Map([[KEY, { mesh: { ok: true, value: malformed } }]]),
      })
    ).toMatchObject({
      ok: false,
      error: { stage: 'evaluation', code: 'INVALID_CANDIDATE_MESH' },
    });
  });

  it('rejects negative Candidate triangle indices before scoring or aggregation', () => {
    const malformed = { ...shapeMesh(), triangles: new Uint32Array([-1, 1, 2]) };
    expect(
      compareEvaluatedOccurrence({
        semanticKey: KEY,
        targets: targets(),
        referenceScenes: scenes(),
        resolvedNodes: resolved(),
        evaluatedNodes: new Map([[KEY, { mesh: { ok: true, value: malformed } }]]),
      })
    ).toMatchObject({
      ok: false,
      error: { stage: 'evaluation', code: 'INVALID_CANDIDATE_MESH' },
    });
  });
});

function targets() {
  return new Map([[KEY, target()]]);
}

function scenes() {
  return new Map([[KEY, { targetKey: KEY, localFrame: FRAME, worldFrame: FRAME }]]);
}

function resolved() {
  return new Map([[KEY, { keyPath: KEY, localFrame: FRAME, worldFrame: FRAME }]]);
}

function evaluated() {
  return new Map([[KEY, { mesh: { ok: true as const, value: shapeMesh() } }]]);
}

function target(): ReconstructionTarget {
  return {
    semanticKey: KEY,
    comparisonSurface: {
      unit: 'millimetre',
      vertices: [
        [0, 0, 0],
        [10, 0, 0],
        [0, 10, 0],
        [0, 0, 10],
      ],
      triangles: [
        [0, 2, 1],
        [0, 1, 3],
        [1, 2, 3],
        [2, 0, 3],
      ],
      closed: true,
    },
  };
}

function shapeMesh(): ShapeMesh {
  const surface = target().comparisonSurface;
  return {
    vertices: new Float32Array(surface.vertices.flat()),
    triangles: new Uint32Array(surface.triangles.flat()),
    normals: new Float32Array(),
    uvs: new Float32Array(),
    faceGroups: [],
  };
}
