import { describe, expect, it, vi } from 'vitest';
import type {
  ComparisonDiagnostic,
  OverallDiagnostic,
  WorkbenchCatalog,
  WorkbenchResult,
} from '../shared/protocol.js';
import { createWorkbenchClient } from '../src/workbenchClient.js';

describe('workbench browser client', () => {
  it('calls the catalog, overall, comparison, and refresh routes with JSON requests', async () => {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse(catalogResult(2))));
    const client = createWorkbenchClient({ fetch: fetchMock, baseUrl: 'http://localhost:4173' });

    await client.loadCatalog();
    await client.loadOverall();
    await client.refreshOverall();
    await client.loadComparison('infra-bridge/rail 01');
    await client.refreshComparison('infra-bridge/rail 01');

    expect(fetchMock.mock.calls.map(([input, init]) => [requestUrl(input), init?.method])).toEqual([
      ['http://localhost:4173/api/workbench', 'GET'],
      ['http://localhost:4173/api/workbench/overall', 'GET'],
      ['http://localhost:4173/api/workbench/overall/refresh', 'POST'],
      ['http://localhost:4173/api/workbench/comparison?semanticKey=infra-bridge%2Frail+01', 'GET'],
      ['http://localhost:4173/api/workbench/refresh?semanticKey=infra-bridge%2Frail+01', 'POST'],
    ]);
    expect(fetchMock.mock.calls[2]?.[1]?.headers).toEqual({ Accept: 'application/json' });
  });

  it('accepts a finite whole-model diagnostic whose payload matches its envelope revision', async () => {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse(overallResult(6))));
    const client = createWorkbenchClient({ fetch: fetchMock });

    const result = await client.loadOverall();

    expect(result).toMatchObject({
      ok: true,
      revision: 6,
      value: { coordinateSpace: 'world', productCount: 47, revision: 6 },
    });
  });

  it('aborts the prior request and discards its late response', async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(async () => first.promise)
      .mockImplementationOnce(async () => second.promise);
    const client = createWorkbenchClient({ fetch: fetchMock });

    const oldRequest = client.loadComparison('infra-bridge/old');
    const oldSignal = fetchMock.mock.calls[0]?.[1]?.signal;
    const newRequest = client.loadComparison('infra-bridge/new');

    expect(oldSignal?.aborted).toBe(true);
    second.resolve(jsonResponse(comparisonResult('infra-bridge/new', 4)));
    expect(await newRequest).toMatchObject({ ok: true, revision: 4 });

    first.resolve(jsonResponse(comparisonResult('infra-bridge/old', 3)));
    expect(await oldRequest).toBeUndefined();
    expect(client.getRequestState()).toEqual({ latestRequestId: 2, acceptedRevision: 4 });
  });

  it('completes the latest request with an actionable failure for an older server revision', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(comparisonResult('infra-bridge/a', 8)))
      .mockResolvedValueOnce(jsonResponse(comparisonResult('infra-bridge/a', 7)));
    const client = createWorkbenchClient({ fetch: fetchMock });

    expect(await client.loadComparison('infra-bridge/a')).toMatchObject({ revision: 8 });
    expect(await client.loadComparison('infra-bridge/a')).toMatchObject({
      ok: false,
      revision: 7,
      error: {
        stage: 'configuration',
        code: 'stale-revision-response',
        context: { responseRevision: 7, acceptedRevision: 8 },
        retryable: true,
      },
    });
    expect(client.getRequestState().acceptedRevision).toBe(8);
  });

  it('reports a stale malformed response at its actual envelope revision', async () => {
    const current = comparisonResult('infra-bridge/a', 8);
    const stale = comparisonResult('infra-bridge/a', 7);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(current))
      .mockResolvedValueOnce(
        jsonResponse({
          ...stale,
          value: { ...stale.value, pass: 'true' },
        })
      );
    const client = createWorkbenchClient({ fetch: fetchMock });

    expect(await client.loadComparison('infra-bridge/a')).toMatchObject({ revision: 8 });
    expect(await client.loadComparison('infra-bridge/a')).toMatchObject({
      ok: false,
      revision: 7,
      error: {
        stage: 'configuration',
        code: 'stale-revision-response',
        context: { responseRevision: 7, acceptedRevision: 8 },
        retryable: true,
      },
    });
    expect(client.getRequestState().acceptedRevision).toBe(8);
  });

  it('advances the revision guard when a newer envelope contains a malformed payload', async () => {
    const current = comparisonResult('infra-bridge/a', 8);
    const newer = comparisonResult('infra-bridge/a', 9);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(current))
      .mockResolvedValueOnce(
        jsonResponse({
          ...newer,
          value: { ...newer.value, pass: 'true' },
        })
      );
    const client = createWorkbenchClient({ fetch: fetchMock });

    expect(await client.loadComparison('infra-bridge/a')).toMatchObject({ revision: 8 });
    expect(await client.loadComparison('infra-bridge/a')).toMatchObject({
      ok: false,
      revision: 9,
      error: { stage: 'configuration', code: 'invalid-json-response', retryable: true },
    });
    expect(client.getRequestState().acceptedRevision).toBe(9);
  });

  it('rejects a successful comparison payload for a different Semantic Key', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(comparisonResult('infra-bridge/wrong', 3)));
    const client = createWorkbenchClient({ fetch: fetchMock });

    const result = await client.loadComparison('infra-bridge/selected');

    expect(result).toMatchObject({
      ok: false,
      error: { stage: 'configuration', code: 'semantic-key-mismatch' },
    });
  });

  it('maps non-JSON HTTP and network failures into actionable structured results', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('proxy exploded', { status: 502 }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const client = createWorkbenchClient({ fetch: fetchMock });

    const httpFailure = await client.loadCatalog();
    const networkFailure = await client.loadCatalog();

    expect(httpFailure).toMatchObject({
      ok: false,
      error: {
        stage: 'configuration',
        code: 'http-502-non-json',
        retryable: true,
      },
    });
    expect(networkFailure).toMatchObject({
      ok: false,
      error: {
        stage: 'configuration',
        code: 'network-error',
        retryable: true,
      },
    });
  });

  it('preserves an actionable structured error returned by the server', async () => {
    const serverError: WorkbenchResult<WorkbenchCatalog> = {
      ok: false,
      revision: 6,
      error: {
        stage: 'checksum',
        code: 'reference-checksum-mismatch',
        message: 'The configured reference does not match the manifest checksum.',
        context: { fileName: 'Infra-Bridge.ifc', expected: 'abc', actual: 'def' },
        retryable: false,
        action: 'Select the checksummed IFC4X3 reference and restart the workbench.',
      },
    };
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse(serverError)));
    const client = createWorkbenchClient({ fetch: fetchMock });

    expect(await client.loadCatalog()).toEqual(serverError);
  });

  it('rejects non-finite JSON numbers in a structured error context', async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(
          '{"ok":false,"revision":6,"error":{"stage":"scoring","code":"scoring-failed","message":"Scoring failed.","context":{"sample":1e400},"retryable":true,"action":"Retry."}}',
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
    );
    const client = createWorkbenchClient({ fetch: fetchMock });

    const result = await client.loadCatalog();

    expect(result).toMatchObject({
      ok: false,
      error: { stage: 'configuration', code: 'invalid-json-response', retryable: true },
    });
  });

  it('maps a malformed successful catalog into an actionable protocol error', async () => {
    const catalog = catalogResult(2);
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        jsonResponse({
          ...catalog,
          value: {
            ...catalog.value,
            products: [
              {
                semanticKey: 'infra-bridge/deck-01',
                group: 'Deck',
                label: 'Deck 01',
                detail: 47,
              },
            ],
          },
        })
      )
    );
    const client = createWorkbenchClient({ fetch: fetchMock });

    const result = await client.loadCatalog();

    expect(result).toMatchObject({
      ok: false,
      error: {
        stage: 'configuration',
        code: 'invalid-json-response',
        retryable: true,
        action: 'Restart the workbench server so the browser and server use the same protocol.',
      },
    });
  });

  it('rejects a successful comparison whose nested surface is not a valid triangle mesh', async () => {
    const comparison = comparisonResult('infra-bridge/deck-01', 3);
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        jsonResponse({
          ...comparison,
          value: {
            ...comparison.value,
            surfaces: {
              ...comparison.value.surfaces,
              reference: {
                ...comparison.value.surfaces.reference,
                vertices: [
                  [0, 0, 0],
                  [1, 'not-a-number', 0],
                  [0, 1, 0],
                ],
              },
            },
          },
        })
      )
    );
    const client = createWorkbenchClient({ fetch: fetchMock });

    const result = await client.loadComparison('infra-bridge/deck-01');

    expect(result).toMatchObject({
      ok: false,
      error: { stage: 'configuration', code: 'invalid-json-response', retryable: true },
    });
  });

  it('rejects a successful comparison whose diagnostic frame is malformed', async () => {
    const comparison = comparisonResult('infra-bridge/deck-01', 3);
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        jsonResponse({
          ...comparison,
          value: {
            ...comparison.value,
            frames: {
              ...comparison.value.frames,
              candidateWorld: {
                ...comparison.value.frames.candidateWorld,
                xAxis: [1, 0],
              },
            },
          },
        })
      )
    );
    const client = createWorkbenchClient({ fetch: fetchMock });

    const result = await client.loadComparison('infra-bridge/deck-01');

    expect(result).toMatchObject({
      ok: false,
      error: { stage: 'configuration', code: 'invalid-json-response', retryable: true },
    });
  });

  it('rejects a successful comparison whose nested score uses an invalid JSON number', async () => {
    const comparison = comparisonResult('infra-bridge/deck-01', 3);
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        jsonResponse({
          ...comparison,
          value: {
            ...comparison.value,
            score: {
              ...comparison.value.score,
              surfaceDistance: {
                ...comparison.value.score.surfaceDistance,
                areaSampleCount: 1.5,
              },
            },
          },
        })
      )
    );
    const client = createWorkbenchClient({ fetch: fetchMock });

    const result = await client.loadComparison('infra-bridge/deck-01');

    expect(result).toMatchObject({
      ok: false,
      error: { stage: 'configuration', code: 'invalid-json-response', retryable: true },
    });
  });

  it('rejects a successful comparison whose Fidelity Gate is malformed', async () => {
    const comparison = comparisonResult('infra-bridge/deck-01', 3);
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        jsonResponse({
          ...comparison,
          value: {
            ...comparison.value,
            gates: [
              {
                id: 'surface-p95',
                value: 0,
                threshold: 1,
                relation: 'approximately',
                unit: 'millimetre',
                status: 'pass',
              },
            ],
          },
        })
      )
    );
    const client = createWorkbenchClient({ fetch: fetchMock });

    const result = await client.loadComparison('infra-bridge/deck-01');

    expect(result).toMatchObject({
      ok: false,
      error: { stage: 'configuration', code: 'invalid-json-response', retryable: true },
    });
  });

  it('rejects type-compatible-looking JSON scalars that violate the comparison protocol', async () => {
    const comparison = comparisonResult('infra-bridge/deck-01', 3);
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        jsonResponse({
          ...comparison,
          value: {
            ...comparison.value,
            pass: 'true',
          },
        })
      )
    );
    const client = createWorkbenchClient({ fetch: fetchMock });

    const result = await client.loadComparison('infra-bridge/deck-01');

    expect(result).toMatchObject({
      ok: false,
      error: { stage: 'configuration', code: 'invalid-json-response', retryable: true },
    });
  });

  it('rejects a successful comparison whose payload revision disagrees with its envelope', async () => {
    const comparison = comparisonResult('infra-bridge/deck-01', 3);
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        jsonResponse({
          ...comparison,
          value: { ...comparison.value, revision: 2 },
        })
      )
    );
    const client = createWorkbenchClient({ fetch: fetchMock });

    const result = await client.loadComparison('infra-bridge/deck-01');

    expect(result).toMatchObject({
      ok: false,
      error: { stage: 'configuration', code: 'invalid-json-response', retryable: true },
    });
  });
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function overallResult(
  revision: number
): Extract<WorkbenchResult<OverallDiagnostic>, { readonly ok: true }> {
  return {
    ok: true,
    revision,
    value: {
      revision,
      durationMs: 1,
      computedAt: '2026-08-20T00:00:00.000Z',
      coordinateSpace: 'world',
      productCount: 47,
      surfaces: { reference: surface(), candidate: surface() },
    },
  };
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

function catalogResult(
  revision: number
): Extract<WorkbenchResult<WorkbenchCatalog>, { readonly ok: true }> {
  return {
    ok: true,
    revision,
    value: {
      title: 'Infra-bridge Reconstruction Workbench',
      products: [
        {
          semanticKey: 'infra-bridge/deck-01',
          group: 'Deck',
          label: 'Deck 01',
          detail: 'Straight deck segment',
        },
      ],
      reference: {
        path: '/tmp/Infra-Bridge.ifc',
        fileName: 'Infra-Bridge.ifc',
        expectedChecksum: 'abc',
        productCount: 47,
      },
      sourceRevision: revision,
    },
  };
}

function comparisonResult(
  semanticKey: string,
  revision: number
): Extract<WorkbenchResult<ComparisonDiagnostic>, { readonly ok: true }> {
  return {
    ok: true,
    revision,
    value: {
      semanticKey,
      revision,
      durationMs: 1,
      computedAt: '2026-08-20T00:00:00.000Z',
      coordinateSpace: 'canonical-component-local',
      surfaces: { reference: surface(), candidate: surface() },
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
        surfaceDistance: { maximumMm: 0, meanMm: 0, p95Mm: 0, areaSampleCount: 1 },
        normalAgreement: { meanCosine: 1, minimumCosine: 1 },
        envelope: {
          deltasMm: { xMin: 0, xMax: 0, yMin: 0, yMax: 0, zMin: 0, zMax: 0 },
          maximumAbsoluteDeltaMm: 0,
        },
        volume: { targetMm3: 100, candidateMm3: 100, relativeError: 0 },
        closedSolidIoU: { value: 1, method: 'exact-envelope' },
      },
      gates: [
        {
          id: 'surface-p95',
          value: 0,
          threshold: 1,
          relation: 'at-most',
          unit: 'millimetre',
          status: 'pass',
        },
      ],
      pass: true,
    },
  };
}

function surface() {
  return {
    unit: 'millimetre' as const,
    vertices: [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ] as const,
    triangles: [[0, 1, 2]] as const,
    closed: false,
  };
}

function frame() {
  return {
    origin: [0, 0, 0] as const,
    xAxis: [1, 0, 0] as const,
    zAxis: [0, 0, 1] as const,
  };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
