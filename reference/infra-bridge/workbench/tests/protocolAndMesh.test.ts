import { describe, expect, it } from 'vitest';
import type { ComparisonDiagnostic, WorkbenchResult } from '../shared/protocol.js';
import { mergeMeshData, surfaceToMeshData } from '../src/mesh.js';

describe('workbench JSON protocol and browser mesh hydration', () => {
  it('round-trips a comparison diagnostic as plain JSON', () => {
    const diagnostic: WorkbenchResult<ComparisonDiagnostic> = {
      ok: true,
      revision: 3,
      value: {
        semanticKey: 'infra-bridge/synthetic/member',
        revision: 3,
        durationMs: 42,
        computedAt: '2026-08-20T08:00:00.000Z',
        coordinateSpace: 'canonical-component-local',
        surfaces: {
          reference: triangleSurface(),
          candidate: triangleSurface(),
        },
        frames: {
          referenceLocal: frame(),
          referenceWorld: frame(),
          canonicalWorld: frame(),
          candidateLocal: frame(),
          candidateWorld: frame(),
        },
        frameDeltas: {
          controlPointDeltaMm: 0,
          xAxisDeltaDegrees: 0,
          zAxisDeltaDegrees: 0,
        },
        score: {
          surfaceDistance: { maximumMm: 0, meanMm: 0, p95Mm: 0, areaSampleCount: 2 },
          normalAgreement: { meanCosine: 1, minimumCosine: 1 },
          envelope: {
            deltasMm: { xMin: 0, xMax: 0, yMin: 0, yMax: 0, zMin: 0, zMax: 0 },
            maximumAbsoluteDeltaMm: 0,
          },
        },
        gates: [],
        pass: true,
      },
    };

    const roundTripped: unknown = JSON.parse(JSON.stringify(diagnostic));
    expect(roundTripped).toEqual(diagnostic);
    expect(containsNonJsonRuntimeValue(roundTripped)).toBe(false);
  });

  it('maps canonical CAD Z-up coordinates into the viewer Y-up frame', () => {
    const mesh = surfaceToMeshData(triangleSurface(), '#4acecc');

    expect(Array.from(mesh.position)).toEqual([0, 0, 0, 2, 0, 0, 0, 0, -3]);
    expect(Array.from(mesh.index)).toEqual([0, 1, 2]);
    expect(Array.from(mesh.normal)).toEqual([0, 1, 0, 0, 1, 0, 0, 1, 0]);
    expect(Array.from(mesh.edges)).toEqual([
      0, 0, 0, 2, 0, 0, 2, 0, 0, 0, 0, -3, 0, 0, -3, 0, 0, 0,
    ]);
    expect(mesh.color).toBe('#4acecc');
  });

  it('deduplicates shared triangle edges', () => {
    const surface = {
      unit: 'millimetre' as const,
      vertices: [
        [0, 0, 0],
        [1, 0, 0],
        [1, 1, 0],
        [0, 1, 0],
      ] as const,
      triangles: [
        [0, 1, 2],
        [0, 2, 3],
      ] as const,
      closed: false,
    };

    expect(surfaceToMeshData(surface).edges).toHaveLength(5 * 2 * 3);
  });

  it('builds one framing mesh that spans every visible diagnostic layer', () => {
    const reference = surfaceToMeshData(triangleSurface());
    const candidate = surfaceToMeshData({
      ...triangleSurface(),
      vertices: [
        [100, 0, 0],
        [102, 0, 0],
        [100, 3, 0],
      ],
    });

    const framing = mergeMeshData([reference, candidate]);

    expect(Array.from(framing.position)).toEqual([...reference.position, ...candidate.position]);
    expect(Array.from(framing.index)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(framing.normal).toHaveLength(reference.normal.length + candidate.normal.length);
  });
});

function frame() {
  return {
    origin: [0, 0, 0] as const,
    xAxis: [1, 0, 0] as const,
    zAxis: [0, 0, 1] as const,
  };
}

function triangleSurface() {
  return {
    unit: 'millimetre' as const,
    vertices: [
      [0, 0, 0],
      [2, 0, 0],
      [0, 3, 0],
    ] as const,
    triangles: [[0, 1, 2]] as const,
    closed: false,
  };
}

function containsNonJsonRuntimeValue(value: unknown): boolean {
  if (value instanceof Map || value instanceof Set || ArrayBuffer.isView(value)) return true;
  if (Array.isArray(value)) return value.some(containsNonJsonRuntimeValue);
  if (typeof value !== 'object' || value === null) return false;
  return Object.values(value).some(containsNonJsonRuntimeValue);
}
