import type { ShapeMesh } from 'brepjs';
import { describe, expect, it } from 'vitest';
import type { ObservedFrame, ReconstructionTarget } from '../../src/index.js';
import { assembleOverallDiagnostic } from '../server/overallDiagnostic.js';

const FIRST = 'infra-bridge/rail-site-01/rail-bridge-01/deck';
const SECOND = 'infra-bridge/road-site/road-river-bridge/deck';
const IDENTITY: ObservedFrame = {
  origin: [0, 0, 0],
  xAxis: [1, 0, 0],
  zAxis: [0, 0, 1],
};

describe('whole-model diagnostic assembly', () => {
  it('places every Reference product in world space and merges world-space Candidate meshes', () => {
    const rotated: ObservedFrame = {
      origin: [10, 20, 30],
      xAxis: [0, 1, 0],
      zAxis: [0, 0, 1],
    };
    const result = assembleOverallDiagnostic({
      semanticKeys: [FIRST, SECOND],
      targets: new Map([
        [
          FIRST,
          target(FIRST, [
            [0, 0, 0],
            [2, 0, 0],
            [0, 3, 0],
          ]),
        ],
        [
          SECOND,
          target(SECOND, [
            [0, 0, 0],
            [1, 0, 0],
            [0, 1, 0],
          ]),
        ],
      ]),
      referenceScenes: new Map([
        [FIRST, { targetKey: FIRST, localFrame: rotated, worldFrame: rotated }],
        [
          SECOND,
          {
            targetKey: SECOND,
            localFrame: IDENTITY,
            worldFrame: { ...IDENTITY, origin: [-5, 0, 0] },
          },
        ],
      ]),
      resolvedNodes: new Map([
        [FIRST, { keyPath: FIRST, localFrame: IDENTITY, worldFrame: IDENTITY }],
        [SECOND, { keyPath: SECOND, localFrame: IDENTITY, worldFrame: IDENTITY }],
      ]),
      evaluatedNodes: new Map([
        [
          FIRST,
          {
            mesh: {
              ok: true,
              value: mesh([
                [100, 200, 300],
                [102, 200, 300],
                [100, 203, 300],
              ]),
            },
          },
        ],
        [
          SECOND,
          {
            mesh: {
              ok: true,
              value: mesh([
                [-5, 0, 0],
                [-4, 0, 0],
                [-5, 1, 0],
              ]),
            },
          },
        ],
      ]),
    });

    expect(result).toEqual({
      ok: true,
      value: {
        coordinateSpace: 'world',
        productCount: 2,
        surfaces: {
          reference: {
            unit: 'millimetre',
            vertices: [
              [10, 20, 30],
              [10, 22, 30],
              [7, 20, 30],
              [-5, 0, 0],
              [-4, 0, 0],
              [-5, 1, 0],
            ],
            triangles: [
              [0, 1, 2],
              [3, 4, 5],
            ],
            closed: false,
          },
          candidate: {
            unit: 'millimetre',
            vertices: [
              [100, 200, 300],
              [102, 200, 300],
              [100, 203, 300],
              [-5, 0, 0],
              [-4, 0, 0],
              [-5, 1, 0],
            ],
            triangles: [
              [0, 1, 2],
              [3, 4, 5],
            ],
            closed: false,
          },
        },
      },
    });
  });

  it('rejects non-rigid Reference and Candidate placements', () => {
    const invalidReference = validOverallRequest();
    invalidReference.referenceScenes.set(FIRST, {
      targetKey: FIRST,
      localFrame: IDENTITY,
      worldFrame: { ...IDENTITY, xAxis: [2, 0, 0] },
    });
    expect(assembleOverallDiagnostic(invalidReference)).toMatchObject({
      ok: false,
      error: {
        stage: 'reference-decode',
        code: 'INVALID_REFERENCE_FRAME',
        context: { semanticKey: FIRST, frame: 'Reference world Frame' },
      },
    });

    const invalidCandidate = validOverallRequest();
    invalidCandidate.resolvedNodes.set(FIRST, {
      keyPath: FIRST,
      localFrame: IDENTITY,
      worldFrame: { ...IDENTITY, zAxis: [1, 0, 0] },
    });
    expect(assembleOverallDiagnostic(invalidCandidate)).toMatchObject({
      ok: false,
      error: {
        stage: 'authored-evaluation',
        code: 'INVALID_CANDIDATE_FRAME',
        context: { semanticKey: FIRST, frame: 'Candidate world Frame' },
      },
    });
  });

  it('rejects empty Reference and Candidate product geometry', () => {
    const emptyReference = validOverallRequest();
    emptyReference.targets.set(FIRST, target(FIRST, []));
    expect(assembleOverallDiagnostic(emptyReference)).toMatchObject({
      ok: false,
      error: { stage: 'reference-decode', code: 'INVALID_REFERENCE_GEOMETRY' },
    });

    const emptyCandidate = validOverallRequest();
    emptyCandidate.evaluatedNodes.set(FIRST, { mesh: { ok: true, value: emptyMesh() } });
    expect(assembleOverallDiagnostic(emptyCandidate)).toMatchObject({
      ok: false,
      error: { stage: 'topology', code: 'INVALID_CANDIDATE_MESH' },
    });
  });
});

function validOverallRequest() {
  return {
    semanticKeys: [FIRST],
    targets: new Map([
      [
        FIRST,
        target(FIRST, [
          [0, 0, 0],
          [1, 0, 0],
          [0, 1, 0],
        ]),
      ],
    ]),
    referenceScenes: new Map([
      [FIRST, { targetKey: FIRST, localFrame: IDENTITY, worldFrame: IDENTITY }],
    ]),
    resolvedNodes: new Map([
      [FIRST, { keyPath: FIRST, localFrame: IDENTITY, worldFrame: IDENTITY }],
    ]),
    evaluatedNodes: new Map([
      [
        FIRST,
        {
          mesh: {
            ok: true as const,
            value: mesh([
              [0, 0, 0],
              [1, 0, 0],
              [0, 1, 0],
            ]),
          },
        },
      ],
    ]),
  };
}

function target(
  semanticKey: string,
  vertices: ReconstructionTarget['comparisonSurface']['vertices']
): ReconstructionTarget {
  return {
    semanticKey,
    comparisonSurface: {
      unit: 'millimetre',
      vertices,
      triangles: vertices.length === 0 ? [] : [[0, 1, 2]],
      closed: false,
    },
  };
}

function emptyMesh(): ShapeMesh {
  return {
    vertices: new Float32Array(),
    triangles: new Uint32Array(),
    normals: new Float32Array(),
    uvs: new Float32Array(),
    faceGroups: [],
  };
}

function mesh(vertices: readonly (readonly [number, number, number])[]): ShapeMesh {
  return {
    vertices: new Float32Array(vertices.flat()),
    triangles: new Uint32Array([0, 1, 2]),
    normals: new Float32Array(),
    uvs: new Float32Array(),
    faceGroups: [],
  };
}
