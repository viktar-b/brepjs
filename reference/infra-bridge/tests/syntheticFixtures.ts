import type {
  AnalyticEvidence,
  ReconstructionTarget,
  ReferenceScene,
  SurfaceObservation,
} from '../src/index.js';

export interface SyntheticIndexedFaceSet {
  readonly points: readonly (readonly [number, number, number])[];
  readonly faces: readonly (readonly [number, number, number])[];
}

export interface SyntheticTriangulatedSolid {
  readonly positions: readonly number[];
  readonly indices: readonly number[];
}

const comparisonSurface: SurfaceObservation = {
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
};

export const indexedFaceSetFixture: SyntheticIndexedFaceSet = {
  points: comparisonSurface.vertices,
  faces: comparisonSurface.triangles,
};

export const triangulatedSolidFixture: SyntheticTriangulatedSolid = {
  positions: comparisonSurface.vertices.flatMap((point) => point),
  indices: comparisonSurface.triangles.flatMap((triangle) => triangle),
};

export function fromIndexedFaceSet(source: SyntheticIndexedFaceSet): ReconstructionTarget {
  return {
    semanticKey: 'synthetic-member',
    comparisonSurface: {
      unit: 'millimetre',
      vertices: source.points,
      triangles: source.faces,
      closed: true,
    },
    dimensions: [{ name: 'control-length', value: 10, unit: 'millimetre' }],
  };
}

export function fromTriangulatedSolid(source: SyntheticTriangulatedSolid): ReconstructionTarget {
  const points = Array.from(
    { length: source.positions.length / 3 },
    (_, index) =>
      source.positions.slice(index * 3, index * 3 + 3) as unknown as readonly [
        number,
        number,
        number,
      ]
  );
  const faces = Array.from(
    { length: source.indices.length / 3 },
    (_, index) =>
      source.indices.slice(index * 3, index * 3 + 3) as unknown as readonly [number, number, number]
  );
  return {
    semanticKey: 'synthetic-member',
    comparisonSurface: {
      unit: 'millimetre',
      vertices: points,
      triangles: faces,
      closed: true,
    },
    dimensions: [{ name: 'control-length', value: 10, unit: 'millimetre' }],
  };
}

export const analyticEvidenceFixture: AnalyticEvidence = {
  surfaces: [
    { kind: 'plane', point: [0, 0, 0], normal: [0, 0, 1] },
    { kind: 'cylinder', origin: [0, 0, 0], axis: [0, 0, 1], radius: 5 },
  ],
  curves: [{ kind: 'circle', center: [0, 0, 0], normal: [0, 0, 1], radius: 5 }],
  topology: { vertexCount: 2, edgeCount: 3, faceCount: 2, closed: false },
};

export const referenceSceneFixture: ReferenceScene = {
  unit: 'millimetre',
  roots: [
    {
      kind: 'spatial',
      referenceKey: 'synthetic-root',
      localFrame: {
        origin: [0, 0, 0],
        xAxis: [1, 0, 0],
        zAxis: [0, 0, 1],
      },
      worldFrame: {
        origin: [0, 0, 0],
        xAxis: [1, 0, 0],
        zAxis: [0, 0, 1],
      },
      children: [
        {
          kind: 'product',
          referenceKey: 'synthetic-product',
          name: 'Synthetic member',
          localFrame: {
            origin: [100, 0, 0],
            xAxis: [1, 0, 0],
            zAxis: [0, 0, 1],
          },
          worldFrame: {
            origin: [100, 0, 0],
            xAxis: [1, 0, 0],
            zAxis: [0, 0, 1],
          },
          material: 'synthetic-material',
          targetKey: 'synthetic-member',
        },
      ],
    },
  ],
};
