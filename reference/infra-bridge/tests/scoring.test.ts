import { describe, expect, it } from 'vitest';
import {
  scoreCandidate,
  type ReconstructionTarget,
  type SurfaceObservation,
} from '@brepjs/infra-bridge-reference';

describe('Reference Harness physical-unit candidate scoring', () => {
  it('scores identical closed solids exactly', () => {
    const surface = boxSurface([0, 0, 0], [10, 20, 30]);
    const result = scoreCandidate(target(surface), surface);

    expect(result).toEqual({
      ok: true,
      value: {
        surfaceDistance: { maximumMm: 0, meanMm: 0, p95Mm: 0, areaSampleCount: 4096 },
        normalAgreement: { meanCosine: 1, minimumCosine: 1 },
        envelope: {
          deltasMm: { xMin: 0, xMax: 0, yMin: 0, yMax: 0, zMin: 0, zMax: 0 },
          maximumAbsoluteDeltaMm: 0,
        },
        volume: { targetMm3: 6000, candidateMm3: 6000, relativeError: 0 },
        closedSolidIoU: { value: 1, method: 'exact-envelope' },
      },
    });
  });

  it('reports physical envelope, surface, volume, normal, and IoU differences', () => {
    const reference = boxSurface([0, 0, 0], [10, 20, 30]);
    const shifted = boxSurface([1, 0, 0], [11, 20, 30]);
    const result = scoreCandidate(target(reference), shifted);

    expect(result).toMatchObject({
      ok: true,
      value: {
        surfaceDistance: { maximumMm: 1, p95Mm: 1, areaSampleCount: 4096 },
        normalAgreement: { minimumCosine: 0 },
        envelope: {
          deltasMm: { xMin: 1, xMax: 1, yMin: 0, yMax: 0, zMin: 0, zMax: 0 },
          maximumAbsoluteDeltaMm: 1,
        },
        volume: { targetMm3: 6000, candidateMm3: 6000, relativeError: 0 },
        closedSolidIoU: { method: 'exact-envelope' },
      },
    });
    if (result.ok) {
      expect(result.value.closedSolidIoU?.value).toBeCloseTo(9 / 11, 12);
      expect(result.value.normalAgreement.meanCosine).toBeGreaterThan(0.9);
    }
  });

  it('detects reversed triangle normals independently of visual envelope and volume', () => {
    const reference = boxSurface([0, 0, 0], [10, 20, 30]);
    const reversed: SurfaceObservation = {
      ...reference,
      triangles: reference.triangles.map(([a, b, c]) => [a, c, b]),
    };
    const result = scoreCandidate(target(reference), reversed);
    expect(result).toMatchObject({
      ok: true,
      value: {
        surfaceDistance: { maximumMm: 0 },
        normalAgreement: { meanCosine: -1, minimumCosine: -1 },
        volume: { relativeError: 0 },
      },
    });
  });

  it('returns a structured error for malformed candidate topology', () => {
    const reference = boxSurface([0, 0, 0], [10, 20, 30]);
    const malformed: SurfaceObservation = {
      ...reference,
      triangles: [[0, 1, 99]],
    };
    expect(scoreCandidate(target(reference), malformed)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_TOPOLOGY', context: { source: 'candidate' } },
    });
  });

  it('identifies malformed Reference topology separately from Candidate topology', () => {
    const candidate = boxSurface([0, 0, 0], [10, 20, 30]);
    const malformedReference: SurfaceObservation = {
      ...candidate,
      triangles: [[0, 1, 99]],
    };

    expect(scoreCandidate(target(malformedReference), candidate)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_TOPOLOGY', context: { source: 'reference' } },
    });
  });

  it('distinguishes an unexpected scorer failure from invalid input topology', () => {
    const reference = boxSurface([0, 0, 0], [10, 20, 30]);
    const overflow = overflowSurface();

    const result = scoreCandidate(target(reference), overflow);

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'SCORING_FAILURE',
        context: { source: 'scoring', cause: expect.any(String) },
      },
    });
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it('uses voxel IoU for a non-envelope closed solid', () => {
    const tetrahedron = tetrahedronSurface();
    const result = scoreCandidate(target(tetrahedron), tetrahedron);
    expect(result).toMatchObject({
      ok: true,
      value: { closedSolidIoU: { value: 1, method: 'voxel-32' } },
    });
  });

  it('keeps area-weighted scores stable for a realistically dense tessellation', () => {
    const coarse = planeSurface(100, 1);
    const dense = planeSurface(100, 80);
    const result = scoreCandidate(target(coarse), dense);
    expect(result).toMatchObject({
      ok: true,
      value: {
        surfaceDistance: { maximumMm: 0, meanMm: 0, p95Mm: 0, areaSampleCount: 4096 },
        normalAgreement: { meanCosine: 1, minimumCosine: 1 },
      },
    });
  });
});

function target(comparisonSurface: SurfaceObservation): ReconstructionTarget {
  return { semanticKey: 'synthetic-box', comparisonSurface };
}

function boxSurface(
  min: readonly [number, number, number],
  max: readonly [number, number, number]
): SurfaceObservation {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  return {
    unit: 'millimetre',
    vertices: [
      [x0, y0, z0],
      [x1, y0, z0],
      [x1, y1, z0],
      [x0, y1, z0],
      [x0, y0, z1],
      [x1, y0, z1],
      [x1, y1, z1],
      [x0, y1, z1],
    ],
    triangles: [
      [0, 2, 1],
      [0, 3, 2],
      [4, 5, 6],
      [4, 6, 7],
      [0, 1, 5],
      [0, 5, 4],
      [1, 2, 6],
      [1, 6, 5],
      [2, 3, 7],
      [2, 7, 6],
      [3, 0, 4],
      [3, 4, 7],
    ],
    closed: true,
  };
}

function tetrahedronSurface(): SurfaceObservation {
  return {
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
      [0, 3, 2],
      [1, 2, 3],
    ],
    closed: true,
  };
}

function overflowSurface(): SurfaceObservation {
  const magnitude = Number.MAX_VALUE;
  return {
    unit: 'millimetre',
    vertices: [
      [magnitude, magnitude, 0],
      [-magnitude, magnitude, 0],
      [0, -magnitude, 0],
    ],
    triangles: [[0, 1, 2]],
    closed: false,
  };
}

function planeSurface(size: number, divisions: number): SurfaceObservation {
  const vertices: [number, number, number][] = [];
  const triangles: [number, number, number][] = [];
  for (let y = 0; y <= divisions; y++) {
    for (let x = 0; x <= divisions; x++) {
      vertices.push([(x / divisions) * size, (y / divisions) * size, 0]);
    }
  }
  const stride = divisions + 1;
  for (let y = 0; y < divisions; y++) {
    for (let x = 0; x < divisions; x++) {
      const a = y * stride + x;
      const b = a + 1;
      const d = a + stride;
      const c = d + 1;
      triangles.push([a, b, c], [a, c, d]);
    }
  }
  return { unit: 'millimetre', vertices, triangles, closed: false };
}
