import { describe, expect, it } from 'vitest';
import {
  compareReconstructionCase,
  type CompareReconstructionCaseRequest,
  type FidelityGateId,
} from '../src/comparisonCase.js';
import type { ObservedFrame, SurfaceObservation } from '../src/index.js';

const IDENTITY_FRAME: ObservedFrame = {
  origin: [0, 0, 0],
  xAxis: [1, 0, 0],
  zAxis: [0, 0, 1],
};

describe('source-neutral reconstruction comparison case', () => {
  it('normalizes translated and rotated occurrences into one component-local frame', () => {
    const frame: ObservedFrame = {
      origin: [120, -35, 8],
      xAxis: [0, 1, 0],
      zAxis: [0, 0, 1],
    };
    const local = boxSurface([0, 0, 0], [10, 20, 30]);

    const result = compareReconstructionCase(
      request('infra-bridge/synthetic/footing', local, frame, frame)
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        semanticKey: 'infra-bridge/synthetic/footing',
        coordinateSpace: 'canonical-component-local',
        surfaces: { reference: local, candidate: local },
        frameDeltas: {
          controlPointDeltaMm: 0,
          xAxisDeltaDegrees: 0,
          zAxisDeltaDegrees: 0,
        },
        score: {
          surfaceDistance: { maximumMm: 0, meanMm: 0, p95Mm: 0 },
          envelope: { maximumAbsoluteDeltaMm: 0 },
          volume: { relativeError: 0 },
          closedSolidIoU: { value: 1 },
        },
        pass: true,
      },
    });
  });

  it('keeps placement drift in Frame evidence instead of local-shape scoring', () => {
    const referenceFrame: ObservedFrame = { ...IDENTITY_FRAME, origin: [100, 200, 300] };
    const candidateFrame: ObservedFrame = { ...IDENTITY_FRAME, origin: [105, 200, 300] };
    const local = boxSurface([0, 0, 0], [10, 20, 30]);

    const result = compareReconstructionCase(
      request('infra-bridge/synthetic/footing', local, referenceFrame, candidateFrame)
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        frameDeltas: { controlPointDeltaMm: 5 },
        score: {
          surfaceDistance: { maximumMm: 0 },
          envelope: { maximumAbsoluteDeltaMm: 0 },
        },
        pass: true,
      },
    });
  });

  it('applies the bridge-deck canonical-axis policy to Reference geometry', () => {
    const local = boxSurface([0, 0, 0], [10, 20, 30]);
    const canonicalCandidateFrame: ObservedFrame = {
      origin: [0, 0, 0],
      xAxis: [0, 1, 0],
      zAxis: [0, 0, 1],
    };
    const canonicalCandidate = mapSurface(local, ([x, y, z]) => [y, x === 0 ? 0 : -x, z]);
    const semanticKey = 'infra-bridge/road-site/road-river-bridge/deck/bridge-deck';
    const input: CompareReconstructionCaseRequest = {
      semanticKey,
      reference: {
        target: { semanticKey, comparisonSurface: local },
        localFrame: IDENTITY_FRAME,
        worldFrame: IDENTITY_FRAME,
      },
      candidate: {
        semanticKey,
        localFrame: canonicalCandidateFrame,
        worldFrame: canonicalCandidateFrame,
        surfaceInWorld: surfaceInWorld(canonicalCandidate, canonicalCandidateFrame),
      },
    };

    const result = compareReconstructionCase(input);

    expect(result).toMatchObject({
      ok: true,
      value: {
        frames: { canonicalWorld: canonicalCandidateFrame },
        surfaces: { reference: canonicalCandidate, candidate: canonicalCandidate },
        score: { surfaceDistance: { maximumMm: 0 } },
      },
    });
  });

  it.each([
    {
      semanticKey: 'infra-bridge/road-site/road-river-bridge/superstructure/main-girder-01',
      xAxis: [0, 0, 1],
      zAxis: [0, -1, 0],
    },
    {
      semanticKey: 'infra-bridge/road-site/road-river-bridge/superstructure/main-girder-02',
      xAxis: [0, 0, 1],
      zAxis: [0, 1, 0],
    },
    {
      semanticKey: 'infra-bridge/road-site/road-river-bridge/substructure/pier-01/cross-girder',
      xAxis: [0, 0, 1],
      zAxis: [0, -1, 0],
    },
    {
      semanticKey: 'infra-bridge/road-site/road-river-bridge/substructure/pier-02/cross-girder',
      xAxis: [0, 0, 1],
      zAxis: [0, 1, 0],
    },
    {
      semanticKey: 'infra-bridge/road-site/road-river-bridge/deck/railing-01',
      xAxis: [0, 1, 0],
      zAxis: [0, 0, 1],
    },
    {
      semanticKey: 'infra-bridge/road-site/road-river-bridge/approach-01/approach-slab',
      xAxis: [0, 1, 0],
      zAxis: [0, 0, 1],
    },
    {
      semanticKey: 'infra-bridge/rail-site-01/rail-bridge-01/superstructure/name-sign-01',
      xAxis: [1, 0, 0],
      zAxis: [0, 1, 0],
    },
    {
      semanticKey: 'infra-bridge/synthetic/footing',
      xAxis: [1, 0, 0],
      zAxis: [0, 0, 1],
    },
  ] as const)(
    'centralizes the canonical-axis policy for $semanticKey',
    ({ semanticKey, xAxis, zAxis }) => {
      const local = boxSurface([0, 0, 0], [10, 20, 30]);
      const expectedFrame: ObservedFrame = {
        origin: [0, 0, 0],
        xAxis: [...xAxis],
        zAxis: [...zAxis],
      };

      const result = compareReconstructionCase(
        request(semanticKey, local, IDENTITY_FRAME, expectedFrame)
      );

      expect(result).toMatchObject({
        ok: true,
        value: { frames: { canonicalWorld: expectedFrame } },
      });
    }
  );

  it('publishes named independent gates and fails beyond an inclusive threshold', () => {
    const local = boxSurface([0, 0, 0], [10, 20, 30]);
    const candidateFrame: ObservedFrame = { ...IDENTITY_FRAME, origin: [5.001, 0, 0] };

    const result = compareReconstructionCase(
      request('infra-bridge/synthetic/footing', local, IDENTITY_FRAME, candidateFrame)
    );

    expect(result).toMatchObject({ ok: true, value: { pass: false } });
    if (!result.ok) throw new Error('expected a comparison');
    expect(
      result.value.gates.filter(({ status }) => status === 'fail').map(({ id }) => id)
    ).toEqual(['frame-control-point']);
    expect(
      result.value.gates
        .filter(({ id }) => id !== 'frame-control-point')
        .every(({ status }) => status === 'pass' || status === 'not-applicable')
    ).toBe(true);
    expect(result.value.gates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'frame-control-point',
          threshold: 5,
          relation: 'at-most',
          status: 'fail',
        }),
        expect.objectContaining({ id: 'normal-mean', status: 'not-applicable' }),
        expect.objectContaining({
          id: 'volume-relative-error',
          threshold: 0.02,
          status: 'pass',
        }),
      ])
    );
  });

  it.each([
    {
      gateId: 'frame-x-axis',
      build: () => {
        const local = boxSurface([0, 0, 0], [10, 20, 30]);
        return request(
          'infra-bridge/synthetic/footing',
          local,
          IDENTITY_FRAME,
          frameWithXAxisDelta(0.0101)
        );
      },
    },
    {
      gateId: 'frame-z-axis',
      build: () => {
        const local = boxSurface([0, 0, 0], [10, 20, 30]);
        return request(
          'infra-bridge/synthetic/footing',
          local,
          IDENTITY_FRAME,
          frameWithZAxisDelta(0.0101)
        );
      },
    },
    {
      gateId: 'envelope-maximum',
      build: () => {
        const local = boxSurface([0, 0, 0], [10, 20, 30]);
        return request(
          'infra-bridge/synthetic/footing',
          local,
          IDENTITY_FRAME,
          IDENTITY_FRAME,
          translateSurface(local, [2.001, 0, 0])
        );
      },
    },
    {
      gateId: 'surface-p95',
      build: () => {
        const outer = boxSurface([0, 0, 0], [200, 200, 200]);
        const inner = boxSurface([25.001, 25.001, 25.001], [174.999, 174.999, 174.999]);
        const cancellingInner = reverseWinding(translateSurface(inner, [0.001, 0, 0]));
        return request(
          'infra-bridge/synthetic/footing',
          outer,
          IDENTITY_FRAME,
          IDENTITY_FRAME,
          combineSurfaces([outer, inner, cancellingInner])
        );
      },
    },
    {
      gateId: 'surface-maximum',
      build: () => {
        const outer = boxSurface([0, 0, 0], [200, 200, 200]);
        const inner = boxSurface([74.999, 74.999, 74.999], [75.001, 75.001, 75.001]);
        const cancellingInner = reverseWinding(translateSurface(inner, [0.01, 0, 0]));
        return request(
          'infra-bridge/synthetic/footing',
          outer,
          IDENTITY_FRAME,
          IDENTITY_FRAME,
          combineSurfaces([outer, inner, cancellingInner])
        );
      },
    },
    {
      gateId: 'normal-mean',
      build: () => {
        const local = boxSurface([0, 0, 0], [1, 100, 10]);
        return request(
          'infra-bridge/synthetic/filler-01',
          local,
          IDENTITY_FRAME,
          IDENTITY_FRAME,
          shearSurfaceXByZ(local, 0.0132)
        );
      },
    },
    {
      gateId: 'volume-relative-error',
      build: () =>
        request(
          'infra-bridge/synthetic/footing',
          boxSurface([0, 0, 0], [10, 20, 30]),
          IDENTITY_FRAME,
          IDENTITY_FRAME,
          boxSurface([0, 0, 0], [10.201, 20, 30])
        ),
    },
  ] satisfies readonly {
    readonly gateId: FidelityGateId;
    readonly build: () => CompareReconstructionCaseRequest;
  }[])('fails only $gateId just beyond its independent threshold', ({ gateId, build }) => {
    const result = compareReconstructionCase(build());

    if (!result.ok) throw new Error(`expected a comparison, received ${result.error.code}`);
    const failed = result.value.gates.filter(({ status }) => status === 'fail');
    expect(failed.map(({ id }) => id)).toEqual([gateId]);
    expect(result.value.pass).toBe(false);

    const gate = failed[0];
    if (gate === undefined || gate.value === null)
      throw new Error('expected numeric gate evidence');
    if (gate.relation === 'at-most') expect(gate.value).toBeGreaterThan(gate.threshold);
    else expect(gate.value).toBeLessThan(gate.threshold);
    expect(Math.abs(gate.value - gate.threshold)).toBeLessThanOrEqual(0.01);
    expect(
      result.value.gates
        .filter(({ id }) => id !== gateId)
        .every(({ status }) => status === 'pass' || status === 'not-applicable')
    ).toBe(true);
  });

  it('keeps exact inclusive envelope and volume thresholds passing', () => {
    const reference = boxSurface([0, 0, 0], [10, 20, 30]);
    const envelope = compareReconstructionCase(
      request(
        'infra-bridge/synthetic/footing',
        reference,
        IDENTITY_FRAME,
        IDENTITY_FRAME,
        translateSurface(reference, [2, 0, 0])
      )
    );
    const volume = compareReconstructionCase(
      request(
        'infra-bridge/synthetic/footing',
        reference,
        IDENTITY_FRAME,
        IDENTITY_FRAME,
        boxSurface([0, 0, 0], [10.2, 20, 30])
      )
    );

    if (!envelope.ok || !volume.ok) throw new Error('expected comparisons at exact thresholds');
    expect(envelope.value.gates.find(({ id }) => id === 'envelope-maximum')).toMatchObject({
      value: 2,
      threshold: 2,
      status: 'pass',
    });
    expect(volume.value.gates.find(({ id }) => id === 'volume-relative-error')).toMatchObject({
      value: 0.02,
      threshold: 0.02,
      status: 'pass',
    });
    expect(envelope.value.pass).toBe(true);
    expect(volume.value.pass).toBe(true);
  });

  it('reports unavailable volume independently and does not pass the aggregate', () => {
    const open = openQuadSurface();
    const result = compareReconstructionCase(
      request('infra-bridge/synthetic/footing', open, IDENTITY_FRAME, IDENTITY_FRAME)
    );

    if (!result.ok) throw new Error('expected an open-surface comparison');
    expect(result.value.gates.find(({ id }) => id === 'volume-relative-error')).toMatchObject({
      value: null,
      status: 'unavailable',
    });
    expect(
      result.value.gates
        .filter(({ id }) => id !== 'volume-relative-error')
        .every(({ status }) => status === 'pass' || status === 'not-applicable')
    ).toBe(true);
    expect(result.value.pass).toBe(false);
  });

  it.each([
    {
      owner: 'Reference',
      source: 'reference',
      mutate: (input: CompareReconstructionCaseRequest): CompareReconstructionCaseRequest => ({
        ...input,
        reference: {
          ...input.reference,
          target: { ...input.reference.target, semanticKey: 'infra-bridge/synthetic/other' },
        },
      }),
    },
    {
      owner: 'Candidate',
      source: 'candidate',
      mutate: (input: CompareReconstructionCaseRequest): CompareReconstructionCaseRequest => ({
        ...input,
        candidate: { ...input.candidate, semanticKey: 'infra-bridge/synthetic/other' },
      }),
    },
  ] as const)(
    'returns a stable selection source for a mismatched $owner key',
    ({ owner, source, mutate }) => {
      const local = boxSurface([0, 0, 0], [10, 20, 30]);
      const input = request(
        'infra-bridge/synthetic/footing',
        local,
        IDENTITY_FRAME,
        IDENTITY_FRAME
      );

      expect(compareReconstructionCase(mutate(input))).toMatchObject({
        ok: false,
        error: {
          stage: 'selection',
          code: 'SEMANTIC_KEY_MISMATCH',
          semanticKey: 'infra-bridge/synthetic/footing',
          message: expect.stringContaining(owner),
          context: { source },
        },
      });
    }
  );

  it.each([
    {
      frame: 'Reference Local Frame',
      source: 'reference',
      mutate: (
        input: CompareReconstructionCaseRequest,
        invalid: ObservedFrame
      ): CompareReconstructionCaseRequest => ({
        ...input,
        reference: { ...input.reference, localFrame: invalid },
      }),
    },
    {
      frame: 'Reference world Frame',
      source: 'reference',
      mutate: (
        input: CompareReconstructionCaseRequest,
        invalid: ObservedFrame
      ): CompareReconstructionCaseRequest => ({
        ...input,
        reference: { ...input.reference, worldFrame: invalid },
      }),
    },
    {
      frame: 'Candidate Local Frame',
      source: 'candidate',
      mutate: (
        input: CompareReconstructionCaseRequest,
        invalid: ObservedFrame
      ): CompareReconstructionCaseRequest => ({
        ...input,
        candidate: { ...input.candidate, localFrame: invalid },
      }),
    },
    {
      frame: 'Candidate world Frame',
      source: 'candidate',
      mutate: (
        input: CompareReconstructionCaseRequest,
        invalid: ObservedFrame
      ): CompareReconstructionCaseRequest => ({
        ...input,
        candidate: { ...input.candidate, worldFrame: invalid },
      }),
    },
  ] as const)(
    'rejects an invalid $frame with stable owner provenance before scoring',
    ({ frame, source, mutate }) => {
      const local = boxSurface([0, 0, 0], [10, 20, 30]);
      const invalid: ObservedFrame = {
        origin: [0, 0, 0],
        xAxis: [1, 0, 0],
        zAxis: [1, 0, 0],
      };
      const input = request(
        'infra-bridge/synthetic/footing',
        local,
        IDENTITY_FRAME,
        IDENTITY_FRAME
      );

      expect(compareReconstructionCase(mutate(input, invalid))).toMatchObject({
        ok: false,
        error: {
          stage: 'canonicalization',
          code: 'INVALID_FRAME',
          context: { source, frame },
        },
      });
    }
  );

  it('attributes malformed Reference topology and suggests repairing Reference evidence', () => {
    const valid = boxSurface([0, 0, 0], [10, 20, 30]);
    const malformedReference: SurfaceObservation = {
      ...valid,
      triangles: [[0, 1, 99]],
    };
    const result = compareReconstructionCase(
      request(
        'infra-bridge/synthetic/footing',
        malformedReference,
        IDENTITY_FRAME,
        IDENTITY_FRAME,
        valid
      )
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        stage: 'scoring',
        code: 'SCORING_FAILED',
        suggestion: expect.stringContaining('Reference'),
        cause: { code: 'INVALID_TOPOLOGY', context: { source: 'reference' } },
      },
    });
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it('attributes malformed Candidate topology and suggests repairing authored geometry', () => {
    const valid = boxSurface([0, 0, 0], [10, 20, 30]);
    const malformedCandidate: SurfaceObservation = {
      ...valid,
      triangles: [[0, 1, 99]],
    };
    const result = compareReconstructionCase(
      request(
        'infra-bridge/synthetic/footing',
        valid,
        IDENTITY_FRAME,
        IDENTITY_FRAME,
        malformedCandidate
      )
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        stage: 'scoring',
        code: 'SCORING_FAILED',
        suggestion: expect.stringContaining('Candidate'),
        cause: { code: 'INVALID_TOPOLOGY', context: { source: 'candidate' } },
      },
    });
  });

  it('preserves an unexpected internal scorer failure as scoring provenance', () => {
    const valid = boxSurface([0, 0, 0], [10, 20, 30]);
    const result = compareReconstructionCase(
      request(
        'infra-bridge/synthetic/footing',
        valid,
        IDENTITY_FRAME,
        IDENTITY_FRAME,
        overflowSurface()
      )
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        stage: 'scoring',
        code: 'SCORING_FAILED',
        suggestion: expect.stringContaining('scoring'),
        cause: { code: 'SCORING_FAILURE', context: { source: 'scoring' } },
      },
    });
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
});

function request(
  semanticKey: string,
  localSurface: SurfaceObservation,
  referenceFrame: ObservedFrame,
  candidateFrame: ObservedFrame,
  candidateLocalSurface: SurfaceObservation = localSurface
): CompareReconstructionCaseRequest {
  return {
    semanticKey,
    reference: {
      target: { semanticKey, comparisonSurface: localSurface },
      localFrame: referenceFrame,
      worldFrame: referenceFrame,
    },
    candidate: {
      semanticKey,
      localFrame: candidateFrame,
      worldFrame: candidateFrame,
      surfaceInWorld: surfaceInWorld(candidateLocalSurface, candidateFrame),
    },
  };
}

function surfaceInWorld(surface: SurfaceObservation, frame: ObservedFrame): SurfaceObservation {
  return mapSurface(surface, (point) => localToWorld(point, frame));
}

function translateSurface(
  surface: SurfaceObservation,
  [x, y, z]: readonly [number, number, number]
): SurfaceObservation {
  return mapSurface(surface, (point) => [point[0] + x, point[1] + y, point[2] + z]);
}

function shearSurfaceXByZ(surface: SurfaceObservation, factor: number): SurfaceObservation {
  return mapSurface(surface, ([x, y, z]) => [x + factor * z, y, z]);
}

function reverseWinding(surface: SurfaceObservation): SurfaceObservation {
  return {
    ...surface,
    triangles: surface.triangles.map(([a, b, c]) => [a, c, b]),
  };
}

function combineSurfaces(surfaces: readonly SurfaceObservation[]): SurfaceObservation {
  const vertices: [number, number, number][] = [];
  const triangles: [number, number, number][] = [];
  for (const surface of surfaces) {
    const offset = vertices.length;
    vertices.push(...surface.vertices.map(([x, y, z]): [number, number, number] => [x, y, z]));
    triangles.push(
      ...surface.triangles.map(([a, b, c]): [number, number, number] => [
        a + offset,
        b + offset,
        c + offset,
      ])
    );
  }
  return {
    unit: 'millimetre',
    vertices,
    triangles,
    closed: surfaces.every(({ closed }) => closed),
  };
}

function frameWithXAxisDelta(degrees: number): ObservedFrame {
  const radians = (degrees * Math.PI) / 180;
  return {
    origin: [0, 0, 0],
    xAxis: [Math.cos(radians), Math.sin(radians), 0],
    zAxis: [0, 0, 1],
  };
}

function frameWithZAxisDelta(degrees: number): ObservedFrame {
  const radians = (degrees * Math.PI) / 180;
  return {
    origin: [0, 0, 0],
    xAxis: [1, 0, 0],
    zAxis: [0, Math.sin(radians), Math.cos(radians)],
  };
}

function mapSurface(
  surface: SurfaceObservation,
  mapper: (point: readonly [number, number, number]) => [number, number, number]
): SurfaceObservation {
  return { ...surface, vertices: surface.vertices.map(mapper) };
}

function localToWorld(
  [x, y, z]: readonly [number, number, number],
  frame: ObservedFrame
): [number, number, number] {
  const yAxis = cross(frame.zAxis, frame.xAxis);
  return [
    frame.origin[0] + x * frame.xAxis[0] + y * yAxis[0] + z * frame.zAxis[0],
    frame.origin[1] + x * frame.xAxis[1] + y * yAxis[1] + z * frame.zAxis[1],
    frame.origin[2] + x * frame.xAxis[2] + y * yAxis[2] + z * frame.zAxis[2],
  ];
}

function cross(
  a: readonly [number, number, number],
  b: readonly [number, number, number]
): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
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

function openQuadSurface(): SurfaceObservation {
  return {
    unit: 'millimetre',
    vertices: [
      [0, 0, 0],
      [10, 0, 0],
      [10, 10, 0],
      [0, 10, 0],
    ],
    triangles: [
      [0, 1, 2],
      [0, 2, 3],
    ],
    closed: false,
  };
}
