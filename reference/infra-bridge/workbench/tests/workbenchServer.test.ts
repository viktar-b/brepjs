import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  SOURCE_INVALIDATED_EVENT,
  WORKBENCH_API,
  type ComparisonDiagnostic,
  type OverallDiagnostic,
  type SourceInvalidatedPayload,
  type WorkbenchCatalog,
  type WorkbenchDiagnosticError,
  type WorkbenchResult,
} from '../shared/protocol.js';
import { parseWorkbenchArguments } from '../server/dev.js';
import { createSsrAuthoredLoader } from '../server/ssrAuthoredLoader.js';
import { startWorkbench } from '../server/startWorkbench.js';
import type { WorkbenchRuntime } from '../server/workbenchRuntime.js';

const KEY = 'infra-bridge/road-site/road-river-bridge/deck/bridge-deck';
const TERMINATION_SIGNALS: readonly NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];

describe('programmatic workbench server', () => {
  it('parses the required IFC path against the process cwd', () => {
    expect(
      parseWorkbenchArguments(
        ['--ifc', '../../tmp/Infra-Bridge.ifc', '--host', 'localhost', '--port', '0'],
        '/repo/reference/infra-bridge'
      )
    ).toEqual({
      ifcPath: '/repo/tmp/Infra-Bridge.ifc',
      host: 'localhost',
      port: 0,
    });
    expect(() => parseWorkbenchArguments([], '/repo/reference/infra-bridge')).toThrow(
      '--ifc is required'
    );
    expect(() =>
      parseWorkbenchArguments(['--ifc', 'bridge.ifc', '--port', '70000'], '/repo')
    ).toThrow('--port must be an integer between 0 and 65535');
  });

  it('serves the SPA and JSON API on an ephemeral port, then closes cleanly', async () => {
    const harness = runtimeHarness();
    const messages: string[] = [];
    const started = await startWorkbench({
      ifcPath: '/unused/Infra-Bridge.ifc',
      host: '127.0.0.1',
      port: 0,
      runtime: harness.runtime,
      log: (message) => messages.push(message),
    });
    const invalidateGraph = vi.spyOn(started.server.environments.ssr.moduleGraph, 'invalidateAll');

    try {
      expect(started.port).toBeGreaterThan(0);
      expect(started.url).toBe(`http://127.0.0.1:${started.port.toString()}/`);
      expect(messages).toEqual([`Infra-bridge workbench: ${started.url}`]);

      const page = await fetch(started.url);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain('<div id="root"></div>');

      const catalog = await fetch(new URL(WORKBENCH_API.catalog, started.url));
      expect(catalog.status).toBe(200);
      expect(catalog.headers.get('content-type')).toContain('application/json');
      await expect(catalog.json()).resolves.toMatchObject({
        ok: true,
        revision: 4,
        value: { products: [{ semanticKey: KEY }] },
      });

      const overall = await fetch(new URL(WORKBENCH_API.overall, started.url));
      expect(overall.status).toBe(200);
      await expect(overall.json()).resolves.toMatchObject({
        ok: true,
        revision: 4,
        value: { coordinateSpace: 'world', productCount: 1 },
      });

      const overallRefresh = await fetch(new URL(WORKBENCH_API.overallRefresh, started.url), {
        method: 'POST',
      });
      expect(overallRefresh.status).toBe(200);
      await expect(overallRefresh.json()).resolves.toMatchObject({
        ok: true,
        revision: 5,
        value: { coordinateSpace: 'world', productCount: 1 },
      });

      const comparison = await fetch(
        new URL(`${WORKBENCH_API.comparison}?semanticKey=${encodeURIComponent(KEY)}`, started.url)
      );
      expect(comparison.status).toBe(200);
      await expect(comparison.json()).resolves.toMatchObject({
        ok: true,
        revision: 5,
        value: { semanticKey: KEY },
      });

      const refresh = await fetch(
        new URL(`${WORKBENCH_API.refresh}?semanticKey=${encodeURIComponent(KEY)}`, started.url),
        { method: 'POST' }
      );
      expect(refresh.status).toBe(200);
      await expect(refresh.json()).resolves.toMatchObject({
        ok: true,
        revision: 6,
        value: { semanticKey: KEY },
      });
      expect(harness.refreshes).toEqual([KEY]);
      expect(invalidateGraph).toHaveBeenCalledTimes(2);

      const firstClose = started.close();
      const concurrentClose = started.close();
      expect(concurrentClose).toBe(firstClose);
      await firstClose;
    } finally {
      await started.close();
    }

    await expect(fetch(started.url)).rejects.toThrow();
  });

  it('closes the listening server when startup reporting fails', async () => {
    let reportedUrl = '';

    await expect(
      startWorkbench({
        ifcPath: '/unused/Infra-Bridge.ifc',
        host: '127.0.0.1',
        port: 0,
        runtime: runtimeHarness().runtime,
        log(message) {
          reportedUrl = message.replace('Infra-bridge workbench: ', '');
          throw new Error('log unavailable');
        },
      })
    ).rejects.toThrow('log unavailable');

    expect(reportedUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/u);
    await expect(fetch(reportedUrl)).rejects.toThrow();
  });

  it('closes the listening server when asynchronous startup reporting rejects', async () => {
    let reportedUrl = '';
    let cleanup: (() => Promise<void>) | undefined;
    const launching = startWorkbench({
      ifcPath: '/unused/Infra-Bridge.ifc',
      host: '127.0.0.1',
      port: 0,
      runtime: runtimeHarness().runtime,
      async log(message) {
        reportedUrl = message.replace('Infra-bridge workbench: ', '');
        await Promise.resolve();
        throw new Error('async log unavailable');
      },
    }).then((started) => {
      cleanup = () => started.close();
      return started;
    });

    try {
      await expect(launching).rejects.toThrow('async log unavailable');
    } finally {
      await cleanup?.();
    }

    expect(reportedUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/u);
    await expect(fetch(reportedUrl)).rejects.toThrow();
  });

  it('returns structured query, route, method, and unknown-key failures', async () => {
    const harness = runtimeHarness();
    const started = await startWorkbench({
      ifcPath: '/unused/Infra-Bridge.ifc',
      host: '127.0.0.1',
      port: 0,
      runtime: harness.runtime,
      log: () => undefined,
    });

    try {
      const wrongMethod = await fetch(new URL(WORKBENCH_API.catalog, started.url), {
        method: 'POST',
      });
      expect(wrongMethod.status).toBe(405);
      expect(wrongMethod.headers.get('allow')).toBe('GET');
      await expect(wrongMethod.json()).resolves.toMatchObject({
        ok: false,
        revision: 4,
        error: { stage: 'configuration', code: 'METHOD_NOT_ALLOWED' },
      });

      const missingKey = await fetch(new URL(WORKBENCH_API.comparison, started.url));
      expect(missingKey.status).toBe(400);
      await expect(missingKey.json()).resolves.toMatchObject({
        ok: false,
        error: { code: 'MISSING_SEMANTIC_KEY' },
      });

      const duplicateKey = await fetch(
        new URL(`${WORKBENCH_API.comparison}?semanticKey=one&semanticKey=two`, started.url)
      );
      expect(duplicateKey.status).toBe(400);
      await expect(duplicateKey.json()).resolves.toMatchObject({
        ok: false,
        error: { code: 'INVALID_SEMANTIC_KEY_QUERY' },
      });

      const unknown = await fetch(
        new URL(`${WORKBENCH_API.comparison}?semanticKey=infra-bridge%2Funknown`, started.url)
      );
      expect(unknown.status).toBe(404);
      await expect(unknown.json()).resolves.toMatchObject({
        ok: false,
        error: { code: 'UNKNOWN_SEMANTIC_KEY' },
      });

      for (const [error, expectedStatus] of [
        [diagnostic('checksum', 'CHECKSUM_MISMATCH'), 409],
        [diagnostic('reference-file', 'REFERENCE_FILE_NOT_FOUND'), 424],
        [diagnostic('scoring', 'SCORING_FAILED'), 422],
      ] as const) {
        harness.comparisonFailures.push(error);
        const failed = await fetch(
          new URL(`${WORKBENCH_API.comparison}?semanticKey=${encodeURIComponent(KEY)}`, started.url)
        );
        expect(failed.status).toBe(expectedStatus);
        await expect(failed.json()).resolves.toMatchObject({
          ok: false,
          error: { stage: error.stage, code: error.code },
        });
      }

      const wrongRefreshMethod = await fetch(
        new URL(`${WORKBENCH_API.refresh}?semanticKey=${encodeURIComponent(KEY)}`, started.url)
      );
      expect(wrongRefreshMethod.status).toBe(405);
      expect(wrongRefreshMethod.headers.get('allow')).toBe('POST');

      const missingRoute = await fetch(
        new URL(`${WORKBENCH_API.catalog}/not-a-route`, started.url)
      );
      expect(missingRoute.status).toBe(404);
      await expect(missingRoute.json()).resolves.toMatchObject({
        ok: false,
        error: { code: 'API_ROUTE_NOT_FOUND' },
      });
    } finally {
      await started.close();
    }
  });

  it('reports unexpected request failures at the current runtime revision', async () => {
    const harness = runtimeHarness();
    const reportedErrors: unknown[] = [];
    const started = await startWorkbench({
      ifcPath: '/unused/Infra-Bridge.ifc',
      host: '127.0.0.1',
      port: 0,
      runtime: harness.runtime,
      log: () => undefined,
      logError: (cause) => {
        reportedErrors.push(cause);
      },
    });

    try {
      const catalog = await fetch(new URL(WORKBENCH_API.catalog, started.url));
      await expect(catalog.json()).resolves.toMatchObject({ ok: true, revision: 4 });
      const rejection = new Error('synthetic request rejection');
      rejection.stack = 'private server stack';
      vi.spyOn(harness.runtime, 'comparison').mockRejectedValueOnce(rejection);

      const failed = await fetch(
        new URL(`${WORKBENCH_API.comparison}?semanticKey=${encodeURIComponent(KEY)}`, started.url)
      );

      expect(failed.status).toBe(500);
      const body: unknown = await failed.json();
      expect(body).toMatchObject({
        ok: false,
        revision: 4,
        error: {
          stage: 'configuration',
          code: 'WORKBENCH_SERVER_FAILURE',
          message: 'synthetic request rejection',
          retryable: true,
        },
      });
      expect(reportedErrors).toEqual([rejection]);
      expect(JSON.stringify(body)).not.toContain('private server stack');
    } finally {
      await started.close();
    }
  });

  it('contains asynchronous error-logger rejection without changing the failure response', async () => {
    const harness = runtimeHarness();
    const reportedErrors: unknown[] = [];
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const loggerFailure = new Error('async logger unavailable');
    loggerFailure.stack = 'private logger stack';
    const started = await startWorkbench({
      ifcPath: '/unused/Infra-Bridge.ifc',
      host: '127.0.0.1',
      port: 0,
      runtime: harness.runtime,
      log: () => undefined,
      async logError(cause) {
        reportedErrors.push(cause);
        await Promise.resolve();
        throw loggerFailure;
      },
    });

    try {
      const rejection = new Error('synthetic request rejection');
      rejection.stack = 'private request stack';
      vi.spyOn(harness.runtime, 'comparison').mockRejectedValueOnce(rejection);

      const failed = await fetch(
        new URL(`${WORKBENCH_API.comparison}?semanticKey=${encodeURIComponent(KEY)}`, started.url)
      );
      const body: unknown = await failed.json();

      expect(failed.status).toBe(500);
      expect(body).toMatchObject({
        ok: false,
        revision: 4,
        error: {
          stage: 'configuration',
          code: 'WORKBENCH_SERVER_FAILURE',
          message: 'synthetic request rejection',
          retryable: true,
        },
      });
      expect(reportedErrors).toEqual([rejection]);
      const stderrOutput = stderr.mock.calls.map(([message]) => String(message)).join('');
      expect(stderrOutput).toContain('private logger stack');
      expect(stderrOutput).toContain('private request stack');
      expect(JSON.stringify(body)).not.toContain('private logger stack');
      expect(JSON.stringify(body)).not.toContain('private request stack');
    } finally {
      stderr.mockRestore();
      await started.close();
    }
  });

  it('invalidates exact authored TS/TSX add, change, and unlink events once per save burst', async () => {
    const harness = runtimeHarness();
    const started = await startWorkbench({
      ifcPath: '/unused/Infra-Bridge.ifc',
      host: '127.0.0.1',
      port: 0,
      runtime: harness.runtime,
      log: () => undefined,
    });
    const send = vi.spyOn(started.server.environments.client.hot, 'send');
    const invalidateGraph = vi.spyOn(started.server.environments.ssr.moduleGraph, 'invalidateAll');
    const authoredTsFile = fileURLToPath(
      new URL('../../../../examples/infra-bridge/src/main.ts', import.meta.url)
    );
    const authoredTsxFile = fileURLToPath(
      new URL('../../../../examples/infra-bridge/src/families/bridgeNameSign.tsx', import.meta.url)
    );
    const unrelatedFile = fileURLToPath(new URL('../src/App.tsx', import.meta.url));

    try {
      started.server.watcher.emit('change', unrelatedFile);
      await delay(40);
      expect(harness.invalidations()).toBe(0);

      started.server.watcher.emit('change', authoredTsFile);
      started.server.watcher.emit('add', authoredTsxFile);
      started.server.watcher.emit('unlink', authoredTsxFile);
      await waitFor(() => harness.invalidations() === 3);
      await delay(100);

      expect(invalidateGraph).toHaveBeenCalledTimes(3);
      expect(customInvalidations(send.mock.calls)).toEqual([]);
      await delay(75);
      expect(customInvalidations(send.mock.calls)).toEqual([{ revision: 7 }]);

      started.server.watcher.emit('change', authoredTsFile);
      await waitFor(() => harness.invalidations() === 4);
      await started.close();
      await delay(175);
      expect(customInvalidations(send.mock.calls)).toEqual([{ revision: 7 }]);
    } finally {
      await started.close();
    }
  });

  it('evaluates the complete text-bearing authored Model through the Vite SSR runner', async () => {
    const started = await startWorkbench({
      ifcPath: '/unused/Infra-Bridge.ifc',
      host: '127.0.0.1',
      port: 0,
      runtime: runtimeHarness().runtime,
      log: () => undefined,
    });

    try {
      const result = await createSsrAuthoredLoader(started.server)();

      expect(result).toMatchObject({ ok: true });
      if (!result.ok) throw new Error(result.error.message);
      expect(
        result.value.evaluatedNodes.get(
          'infra-bridge/rail-site-01/rail-bridge-01/superstructure/name-sign-01'
        )?.mesh.ok
      ).toBe(true);
    } finally {
      await started.close();
    }
  }, 30_000);

  it.each(TERMINATION_SIGNALS)(
    'closes the typed launcher cleanly on %s',
    async (signal) => {
      const referenceWorkspace = fileURLToPath(new URL('../../', import.meta.url));
      const child = spawn(
        process.execPath,
        [
          fileURLToPath(new URL('../../../../node_modules/tsx/dist/cli.mjs', import.meta.url)),
          '--tsconfig',
          fileURLToPath(new URL('../tsconfig.server.json', import.meta.url)),
          fileURLToPath(new URL('../server/dev.ts', import.meta.url)),
          '--ifc',
          '/unused/Infra-Bridge.ifc',
          '--port',
          '0',
        ],
        { cwd: referenceWorkspace, stdio: ['ignore', 'pipe', 'pipe'] }
      );
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      let output = '';
      let errors = '';
      child.stdout.on('data', (chunk: string) => {
        output += chunk;
      });
      child.stderr.on('data', (chunk: string) => {
        errors += chunk;
      });

      try {
        await waitFor(() => output.includes('Infra-bridge workbench: http://127.0.0.1:'));
        const exited = childExit(child);
        expect(child.kill(signal)).toBe(true);
        // The tsx launcher preserves the conventional 128 + SIGTERM exit code after cleanup.
        await expect(exited).resolves.toEqual({
          code: signal === 'SIGTERM' ? 143 : 0,
          signal: null,
        });
        expect(errors).toBe('');
      } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }
    },
    10_000
  );
});

function runtimeHarness(): {
  readonly runtime: WorkbenchRuntime;
  readonly refreshes: string[];
  readonly invalidations: () => number;
  readonly comparisonFailures: WorkbenchDiagnosticError[];
} {
  let revision = 4;
  let invalidations = 0;
  const refreshes: string[] = [];
  const comparisonFailures: WorkbenchDiagnosticError[] = [];
  const runtime: WorkbenchRuntime = {
    catalog() {
      return Promise.resolve(catalogResult(revision));
    },
    comparison(semanticKey) {
      const comparisonFailure = comparisonFailures.shift();
      if (comparisonFailure !== undefined) {
        return Promise.resolve({ ok: false, revision, error: comparisonFailure });
      }
      if (semanticKey !== KEY) {
        return Promise.resolve({
          ok: false,
          revision,
          error: {
            stage: 'configuration',
            code: 'UNKNOWN_SEMANTIC_KEY',
            message: 'Unknown Semantic Key',
            context: { semanticKey },
            retryable: false,
            action: 'Choose a catalog product',
          },
        });
      }
      return Promise.resolve(comparisonResult(semanticKey, revision));
    },
    overall() {
      return Promise.resolve(overallResult(revision));
    },
    refreshOverall() {
      revision += 1;
      return Promise.resolve(overallResult(revision));
    },
    refresh(semanticKey) {
      refreshes.push(semanticKey);
      revision += 1;
      return Promise.resolve(comparisonResult(semanticKey, revision));
    },
    invalidateSource() {
      invalidations += 1;
      revision += 1;
      return revision;
    },
  };
  return {
    runtime,
    refreshes,
    invalidations: () => invalidations,
    comparisonFailures,
  };
}

function overallResult(revision: number): WorkbenchResult<OverallDiagnostic> {
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
    ok: true,
    revision,
    value: {
      revision,
      durationMs: 8,
      computedAt: '2026-08-20T08:00:00.000Z',
      coordinateSpace: 'world',
      productCount: 1,
      surfaces: { reference: surface, candidate: surface },
    },
  };
}

function diagnostic(
  stage: WorkbenchDiagnosticError['stage'],
  code: string
): WorkbenchDiagnosticError {
  return {
    stage,
    code,
    message: `Synthetic ${stage} failure`,
    context: {},
    retryable: true,
    action: 'Repair the synthetic failure',
  };
}

function customInvalidations(
  calls: ReadonlyArray<readonly unknown[]>
): readonly SourceInvalidatedPayload[] {
  return calls.flatMap((call) =>
    call[0] === SOURCE_INVALIDATED_EVENT &&
    typeof call[1] === 'object' &&
    call[1] !== null &&
    'revision' in call[1] &&
    typeof call[1].revision === 'number'
      ? [{ revision: call[1].revision }]
      : []
  );
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return;
    await delay(10);
  }
  throw new Error('condition was not reached');
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function childExit(child: ReturnType<typeof spawn>): Promise<{
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}> {
  return new Promise((resolveExit, rejectExit) => {
    const timeout = setTimeout(() => {
      rejectExit(new Error('typed workbench launcher did not exit after its termination signal'));
    }, 5_000);
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      resolveExit({ code, signal });
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      rejectExit(error);
    });
  });
}

function catalogResult(revision: number): WorkbenchResult<WorkbenchCatalog> {
  return {
    ok: true,
    revision,
    value: {
      title: 'Infra-bridge Reconstruction Workbench',
      products: [
        {
          semanticKey: KEY,
          group: 'Road river bridge',
          label: 'Bridge Deck',
          detail: 'Deck / Bridge Deck',
        },
      ],
      reference: {
        path: '/unused/Infra-Bridge.ifc',
        fileName: 'Infra-Bridge.ifc',
        expectedChecksum: 'expected-sha',
        productCount: 1,
      },
      sourceRevision: revision,
    },
  };
}

function comparisonResult(
  semanticKey: string,
  revision: number
): WorkbenchResult<ComparisonDiagnostic> {
  const frame = {
    origin: [0, 0, 0],
    xAxis: [1, 0, 0],
    zAxis: [0, 0, 1],
  } as const;
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
    ok: true,
    revision,
    value: {
      semanticKey,
      revision,
      durationMs: 12,
      computedAt: '2026-08-20T08:00:00.000Z',
      coordinateSpace: 'canonical-component-local',
      surfaces: { reference: surface, candidate: surface },
      frames: {
        referenceLocal: frame,
        referenceWorld: frame,
        canonicalWorld: frame,
        candidateLocal: frame,
        candidateWorld: frame,
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
      },
      gates: [],
      pass: true,
    },
  };
}
