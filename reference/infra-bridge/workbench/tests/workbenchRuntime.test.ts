import { describe, expect, it } from 'vitest';
import type {
  ComparisonCaseError,
  ComponentComparisonCase,
  ReferenceManifest,
} from '../../src/index.js';
import {
  createWorkbenchRuntime,
  type AuthoredSnapshot,
  type ReferenceSnapshot,
  type WorkbenchRuntimeDependencies,
} from '../server/workbenchRuntime.js';

const FIRST = 'infra-bridge/rail-site-01/rail-bridge-01/superstructure/filler-01';
const SECOND = 'infra-bridge/road-site/road-river-bridge/deck/bridge-deck';

describe('cached workbench runtime', () => {
  it('publishes every manifest product in manifest order without decoding the Reference', async () => {
    const harness = runtimeHarness();

    const catalog = await harness.runtime.catalog();

    expect(catalog).toMatchObject({
      ok: true,
      revision: 0,
      value: {
        products: [{ semanticKey: FIRST }, { semanticKey: SECOND }],
        reference: {
          path: '/reference/Infra-Bridge.ifc',
          fileName: 'Infra-Bridge.ifc',
          expectedChecksum: 'expected-sha',
          productCount: 2,
        },
      },
    });
    expect(harness.counts.reference).toBe(0);
    expect(harness.counts.authored).toBe(0);
  });

  it('loads the Reference and full authored Model once, then caches each selected key', async () => {
    const harness = runtimeHarness();

    const [first, repeated] = await Promise.all([
      harness.runtime.comparison(FIRST),
      harness.runtime.comparison(FIRST),
    ]);
    const second = await harness.runtime.comparison(SECOND);

    expect(first).toMatchObject({ ok: true, revision: 0, value: { semanticKey: FIRST } });
    expect(repeated).toEqual(first);
    expect(second).toMatchObject({ ok: true, revision: 0, value: { semanticKey: SECOND } });
    expect(harness.counts).toEqual({ reference: 1, authored: 1, compare: 2 });
  });

  it('invalidates only authored/per-key caches and preserves the checksummed Reference', async () => {
    const harness = runtimeHarness();
    await harness.runtime.comparison(FIRST);

    expect(harness.runtime.invalidateSource()).toBe(1);
    const refreshed = await harness.runtime.comparison(FIRST);

    expect(refreshed).toMatchObject({ ok: true, revision: 1, value: { revision: 1 } });
    expect(harness.counts).toEqual({ reference: 1, authored: 2, compare: 2 });
  });

  it('never compares against an authored snapshot made stale by a newer edit', async () => {
    const oldSnapshot = deferred<{
      readonly ok: true;
      readonly value: AuthoredSnapshot;
    }>();
    const currentSnapshot = deferred<{
      readonly ok: true;
      readonly value: AuthoredSnapshot;
    }>();
    const comparedOrigins: number[] = [];
    let evaluationCalls = 0;
    const runtime = createWorkbenchRuntime(
      { ifcPath: '/reference/Infra-Bridge.ifc', manifest: manifest() },
      {
        loadReference: () =>
          Promise.resolve({
            ok: true,
            value: { targets: new Map(), referenceScenes: new Map() },
          }),
        evaluateAuthored() {
          evaluationCalls += 1;
          return evaluationCalls === 1 ? oldSnapshot.promise : currentSnapshot.promise;
        },
        compare(request) {
          const node = request.resolvedNodes.get(FIRST);
          comparedOrigins.push(node?.localFrame.origin[0] ?? Number.NaN);
          return { ok: true, value: comparisonCase(request.semanticKey) };
        },
        now: () => 1_000,
        isoNow: () => '2026-08-20T08:00:00.000Z',
      }
    );

    const requestedBeforeEdit = runtime.comparison(FIRST);
    expect(runtime.invalidateSource()).toBe(1);
    const requestedAfterEdit = runtime.comparison(FIRST);
    oldSnapshot.resolve({ ok: true, value: authoredSnapshotAt(0) });
    await waitFor(() => evaluationCalls === 2);
    currentSnapshot.resolve({ ok: true, value: authoredSnapshotAt(100) });

    await expect(requestedBeforeEdit).resolves.toMatchObject({ ok: true, revision: 1 });
    await expect(requestedAfterEdit).resolves.toMatchObject({ ok: true, revision: 1 });
    expect(comparedOrigins).not.toContain(0);
    expect(comparedOrigins.every((origin) => origin === 100)).toBe(true);
  });

  it('does not permanently cache a failed Reference load', async () => {
    const harness = runtimeHarness();
    harness.referenceResults.push({
      ok: false,
      error: {
        stage: 'reference-file',
        code: 'REFERENCE_FILE_NOT_FOUND',
        message: 'Reference file does not exist',
        context: { path: '/reference/Infra-Bridge.ifc' },
        retryable: true,
        action: 'Correct --ifc and retry',
      },
    });

    const failed = await harness.runtime.comparison(FIRST);
    const recovered = await harness.runtime.comparison(FIRST);

    expect(failed).toMatchObject({
      ok: false,
      error: { stage: 'reference-file', code: 'REFERENCE_FILE_NOT_FOUND' },
    });
    expect(recovered).toMatchObject({ ok: true, value: { semanticKey: FIRST } });
    expect(harness.counts.reference).toBe(2);
  });

  it('does not permanently cache a rejected Reference load', async () => {
    const harness = runtimeHarness();
    harness.referenceRejections.push(new Error('decoder crashed'));

    await expect(harness.runtime.comparison(FIRST)).rejects.toThrow('decoder crashed');
    await expect(harness.runtime.comparison(FIRST)).resolves.toMatchObject({
      ok: true,
      revision: 0,
      value: { semanticKey: FIRST },
    });
    expect(harness.counts.reference).toBe(2);
  });

  it('recomputes a retryable comparison failure without source invalidation', async () => {
    const harness = runtimeHarness();
    harness.comparisonError = {
      stage: 'scoring',
      code: 'SCORING_FAILED',
      semanticKey: FIRST,
      message: 'The surfaces could not be scored',
      suggestion: 'Retry the comparison',
      context: {},
    };

    const failed = await harness.runtime.comparison(FIRST);
    harness.comparisonError = undefined;
    const recovered = await harness.runtime.comparison(FIRST);

    expect(failed).toMatchObject({
      ok: false,
      revision: 0,
      error: { code: 'SCORING_FAILED', retryable: true },
    });
    expect(recovered).toMatchObject({
      ok: true,
      revision: 0,
      value: { semanticKey: FIRST },
    });
    expect(harness.counts).toEqual({ reference: 1, authored: 1, compare: 2 });
  });

  it('coalesces concurrent retryable comparisons but allows the next request to retry', async () => {
    const harness = runtimeHarness();
    harness.comparisonError = {
      stage: 'scoring',
      code: 'SCORING_FAILED',
      semanticKey: FIRST,
      message: 'The surfaces could not be scored',
      suggestion: 'Retry the comparison',
      context: {},
    };

    const [first, concurrent] = await Promise.all([
      harness.runtime.comparison(FIRST),
      harness.runtime.comparison(FIRST),
    ]);
    harness.comparisonError = undefined;
    const recovered = await harness.runtime.comparison(FIRST);

    expect(first).toMatchObject({ ok: false, error: { retryable: true } });
    expect(concurrent).toEqual(first);
    expect(recovered).toMatchObject({ ok: true, value: { semanticKey: FIRST } });
    expect(harness.counts).toEqual({ reference: 1, authored: 1, compare: 2 });
  });

  it('returns actionable configuration and comparison-stage errors', async () => {
    const harness = runtimeHarness();
    const missing = await harness.runtime.comparison('infra-bridge/not-in-manifest');
    const missingRefresh = await harness.runtime.refresh('infra-bridge/not-in-manifest');
    harness.comparisonError = {
      stage: 'scoring',
      code: 'SCORING_FAILED',
      semanticKey: FIRST,
      message: 'The surfaces could not be scored',
      suggestion: 'Repair the topology',
      context: {},
      cause: {
        code: 'INVALID_TOPOLOGY',
        message: 'Invalid shell',
        context: { source: 'candidate' },
      },
    };
    const topology = await harness.runtime.refresh(FIRST);

    expect(missing).toMatchObject({
      ok: false,
      error: {
        stage: 'configuration',
        code: 'UNKNOWN_SEMANTIC_KEY',
        retryable: false,
      },
    });
    expect(missingRefresh).toMatchObject({
      ok: false,
      revision: 0,
      error: { code: 'UNKNOWN_SEMANTIC_KEY' },
    });
    expect(topology).toMatchObject({
      ok: false,
      revision: 1,
      error: {
        stage: 'topology',
        code: 'SCORING_FAILED',
        message: 'The surfaces could not be scored',
        context: {
          semanticKey: FIRST,
          source: 'candidate',
          causeCode: 'INVALID_TOPOLOGY',
          causeMessage: 'Invalid shell',
        },
        retryable: true,
        action: 'Repair the topology',
      },
    });
    expect(harness.counts.authored).toBe(1);
    expect(JSON.parse(JSON.stringify(topology))).toEqual(topology);
  });

  it.each([
    {
      source: 'reference',
      expectedStage: 'reference-decode',
      expectedRetryable: false,
    },
    {
      source: 'candidate',
      expectedStage: 'authored-evaluation',
      expectedRetryable: true,
    },
  ] as const)(
    'maps a $source Semantic-Key mismatch to $expectedStage',
    async ({ source, expectedStage, expectedRetryable }) => {
      const harness = runtimeHarness();
      harness.comparisonError = {
        stage: 'selection',
        code: 'SEMANTIC_KEY_MISMATCH',
        semanticKey: FIRST,
        message: 'Selected evidence does not match',
        suggestion: 'Repair exact-key selection',
        context: { source },
      };

      const result = await harness.runtime.comparison(FIRST);

      expect(result).toMatchObject({
        ok: false,
        error: { stage: expectedStage, retryable: expectedRetryable },
      });
    }
  );

  it.each([
    {
      source: 'reference',
      expectedStage: 'reference-decode',
      expectedRetryable: false,
      expectsRestart: true,
    },
    {
      source: 'candidate',
      expectedStage: 'topology',
      expectedRetryable: true,
      expectsRestart: false,
    },
  ] as const)(
    'maps an invalid $source frame to $expectedStage',
    async ({ source, expectedStage, expectedRetryable, expectsRestart }) => {
      const harness = runtimeHarness();
      const frame = source === 'reference' ? 'Reference world Frame' : 'Candidate world Frame';
      harness.comparisonError = {
        stage: 'canonicalization',
        code: 'INVALID_FRAME',
        semanticKey: FIRST,
        message: `The ${source} frame is invalid`,
        suggestion: `Repair the ${source} occurrence placement`,
        context: { source, frame },
      };

      const result = await harness.runtime.comparison(FIRST);

      expect(result).toMatchObject({
        ok: false,
        error: {
          stage: expectedStage,
          code: 'INVALID_FRAME',
          context: { semanticKey: FIRST, source, frame },
          retryable: expectedRetryable,
        },
      });
      if (result.ok) throw new Error('expected an invalid Frame failure');
      expect(result.error.action.includes('Restart')).toBe(expectsRestart);
    }
  );

  it('marks cached Reference selection failures as requiring restart', async () => {
    const harness = runtimeHarness();
    harness.comparisonError = {
      stage: 'selection',
      code: 'REFERENCE_TARGET_MISSING',
      semanticKey: FIRST,
      message: 'Reference target is absent',
      suggestion: 'Repair the decoded Reference index',
      context: {},
    };

    const result = await harness.runtime.comparison(FIRST);
    harness.comparisonError = undefined;
    const repeated = await harness.runtime.comparison(FIRST);

    expect(result).toMatchObject({
      ok: false,
      error: { stage: 'reference-decode', retryable: false },
    });
    expect(repeated).toEqual(result);
    expect(harness.counts.compare).toBe(1);
    if (result.ok) throw new Error('expected a Reference selection failure');
    expect(result.error.action).toContain('Restart');
  });

  it.each([
    {
      code: 'INVALID_CANDIDATE_MESH',
      stage: 'evaluation',
      expectedStage: 'topology',
    },
    { code: 'INVALID_FRAME', stage: 'canonicalization', expectedStage: 'topology' },
    {
      code: 'CANDIDATE_EVALUATION_FAILED',
      stage: 'evaluation',
      expectedStage: 'authored-evaluation',
    },
    { code: 'SCORING_FAILED', stage: 'scoring', expectedStage: 'scoring' },
  ] as const)(
    'maps $code to the $expectedStage diagnostic stage',
    async ({ code, stage, expectedStage }) => {
      const harness = runtimeHarness();
      harness.comparisonError = {
        stage,
        code,
        semanticKey: FIRST,
        message: `${code} test failure`,
        suggestion: 'Follow the focused repair action',
        context: {},
      };

      const result = await harness.runtime.comparison(FIRST);

      expect(result).toMatchObject({
        ok: false,
        error: { stage: expectedStage, code, action: 'Follow the focused repair action' },
      });
    }
  );

  it('preserves authored-evaluation identity while exposing evaluator cause details in context', async () => {
    const harness = runtimeHarness();
    harness.comparisonError = {
      stage: 'evaluation',
      code: 'CANDIDATE_EVALUATION_FAILED',
      semanticKey: FIRST,
      message: 'The authored occurrence could not be evaluated',
      suggestion: 'Repair the authored Family',
      context: { phase: 'evaluateModel' },
      cause: {
        code: 'FUSE_FAILED',
        message: 'The fuse operation returned an error',
        context: { operation: 'fuse' },
      },
    };

    const result = await harness.runtime.comparison(FIRST);

    expect(result).toMatchObject({
      ok: false,
      error: {
        stage: 'authored-evaluation',
        code: 'CANDIDATE_EVALUATION_FAILED',
        message: 'The authored occurrence could not be evaluated',
        context: {
          semanticKey: FIRST,
          phase: 'evaluateModel',
          operation: 'fuse',
          causeCode: 'FUSE_FAILED',
          causeMessage: 'The fuse operation returned an error',
        },
      },
    });
  });

  it.each([
    {
      source: 'reference',
      causeCode: 'INVALID_TOPOLOGY',
      expectedStage: 'reference-decode',
      expectedRetryable: false,
      expectsRestart: true,
    },
    {
      source: 'candidate',
      causeCode: 'INVALID_TOPOLOGY',
      expectedStage: 'topology',
      expectedRetryable: true,
      expectsRestart: false,
    },
    {
      source: 'scoring',
      causeCode: 'SCORING_FAILURE',
      expectedStage: 'scoring',
      expectedRetryable: true,
      expectsRestart: false,
    },
  ] as const)(
    'maps $source scoring provenance to $expectedStage',
    async ({ source, causeCode, expectedStage, expectedRetryable, expectsRestart }) => {
      const harness = runtimeHarness();
      harness.comparisonError = {
        stage: 'scoring',
        code: 'SCORING_FAILED',
        semanticKey: FIRST,
        message: 'The canonical component surfaces could not be scored',
        suggestion: 'Inspect the selected comparison surface',
        context: { operation: 'scoreCandidate' },
        cause: {
          code: causeCode,
          message: `${source} scoring failure`,
          context: { source },
        },
      };

      const result = await harness.runtime.comparison(FIRST);

      expect(result).toMatchObject({
        ok: false,
        error: {
          stage: expectedStage,
          code: 'SCORING_FAILED',
          message: 'The canonical component surfaces could not be scored',
          context: {
            semanticKey: FIRST,
            operation: 'scoreCandidate',
            source,
            causeCode,
            causeMessage: `${source} scoring failure`,
          },
          retryable: expectedRetryable,
        },
      });
      if (result.ok) throw new Error('expected a scoring provenance failure');
      expect(result.error.action.includes('Restart')).toBe(expectsRestart);
    }
  );

  it('does not infer Candidate provenance from a source-less scoring cause', async () => {
    const harness = runtimeHarness();
    harness.comparisonError = {
      stage: 'scoring',
      code: 'SCORING_FAILED',
      semanticKey: FIRST,
      message: 'The surfaces could not be scored',
      suggestion: 'Inspect scorer diagnostics',
      context: {},
      cause: { code: 'INVALID_TOPOLOGY', message: 'Unattributed invalid topology' },
    };

    const result = await harness.runtime.comparison(FIRST);

    expect(result).toMatchObject({
      ok: false,
      error: {
        stage: 'scoring',
        code: 'SCORING_FAILED',
        message: 'The surfaces could not be scored',
        context: {
          semanticKey: FIRST,
          causeCode: 'INVALID_TOPOLOGY',
          causeMessage: 'Unattributed invalid topology',
        },
        retryable: true,
        action: 'Inspect scorer diagnostics',
      },
    });
  });
});

function runtimeHarness() {
  const counts = { reference: 0, authored: 0, compare: 0 };
  const referenceResults: Array<
    | { readonly ok: true; readonly value: ReferenceSnapshot }
    | {
        readonly ok: false;
        readonly error: {
          readonly stage: 'reference-file';
          readonly code: string;
          readonly message: string;
          readonly context: Readonly<Record<string, string>>;
          readonly retryable: boolean;
          readonly action: string;
        };
      }
  > = [];
  const referenceRejections: Error[] = [];
  let comparisonError: Parameters<WorkbenchRuntimeDependencies['compare']>[0] extends never
    ? never
    : ComparisonCaseError | undefined;
  const referenceSnapshot: ReferenceSnapshot = {
    targets: new Map(),
    referenceScenes: new Map(),
  };
  const authoredSnapshot: AuthoredSnapshot = {
    resolvedNodes: new Map(),
    evaluatedNodes: new Map(),
  };
  const dependencies: WorkbenchRuntimeDependencies = {
    loadReference() {
      counts.reference += 1;
      const rejection = referenceRejections.shift();
      if (rejection !== undefined) return Promise.reject(rejection);
      return Promise.resolve(referenceResults.shift() ?? { ok: true, value: referenceSnapshot });
    },
    evaluateAuthored() {
      counts.authored += 1;
      return Promise.resolve({ ok: true, value: authoredSnapshot });
    },
    compare(request) {
      counts.compare += 1;
      return comparisonError === undefined
        ? { ok: true, value: comparisonCase(request.semanticKey) }
        : { ok: false, error: comparisonError };
    },
    now: () => 1_000,
    isoNow: () => '2026-08-20T08:00:00.000Z',
  };
  const runtime = createWorkbenchRuntime(
    {
      ifcPath: '/reference/Infra-Bridge.ifc',
      manifest: manifest(),
    },
    dependencies
  );
  return {
    runtime,
    counts,
    referenceResults,
    referenceRejections,
    get comparisonError() {
      return comparisonError;
    },
    set comparisonError(value) {
      comparisonError = value;
    },
  };
}

function manifest(): ReferenceManifest {
  return {
    checksum: 'expected-sha',
    mappings: [
      { semanticKey: FIRST, referenceGlobalId: 'first-source-id' },
      { semanticKey: SECOND, referenceGlobalId: 'second-source-id' },
    ],
  };
}

function comparisonCase(semanticKey: string): ComponentComparisonCase {
  const frame = { origin: [0, 0, 0], xAxis: [1, 0, 0], zAxis: [0, 0, 1] } as const;
  const surface = {
    unit: 'millimetre' as const,
    vertices: [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ] as const,
    triangles: [[0, 1, 2]] as const,
    closed: false,
  };
  return {
    semanticKey,
    coordinateSpace: 'canonical-component-local',
    surfaces: { reference: surface, candidate: surface },
    frames: {
      referenceLocal: frame,
      referenceWorld: frame,
      canonicalWorld: frame,
      candidateLocal: frame,
      candidateWorld: frame,
    },
    frameDeltas: { controlPointDeltaMm: 0, xAxisDeltaDegrees: 0, zAxisDeltaDegrees: 0 },
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
  };
}

function authoredSnapshotAt(originX: number): AuthoredSnapshot {
  return {
    resolvedNodes: new Map([
      [
        FIRST,
        {
          keyPath: FIRST,
          localFrame: {
            origin: [originX, 0, 0],
            xAxis: [1, 0, 0],
            zAxis: [0, 0, 1],
          },
          worldFrame: {
            origin: [originX, 0, 0],
            xAxis: [1, 0, 0],
            zAxis: [0, 0, 1],
          },
        },
      ],
    ]),
    evaluatedNodes: new Map(),
  };
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (condition()) return;
    await Promise.resolve();
  }
  throw new Error('condition was not reached');
}

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolver: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolver = resolve;
  });
  return {
    promise,
    resolve(value) {
      if (resolver === undefined) throw new Error('deferred resolver was not initialized');
      resolver(value);
    },
  };
}
