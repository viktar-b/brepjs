import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REPRESENTATIVE_COMPARISON_KEYS,
  type FreshBatchComparisonEvidence,
  type RepresentativeComparisonName,
} from '../../scripts/comparisonEvidence.js';
import type { WorkbenchRuntime } from '../server/workbenchRuntime.js';
import type { DiagnosticScore } from '../shared/protocol.js';

export const EXPECTED_PRODUCT_COUNT = 47;

export type GoldenCaseName = RepresentativeComparisonName;

export interface GoldenTolerances {
  readonly frameAndEnvelopeMm: number;
  readonly surfaceMm: number;
  readonly ratio: number;
  readonly voxel32IoU: number;
}

export interface GoldenCase {
  readonly semanticKey: string;
  readonly frame: readonly [number, number, number];
  readonly envelope: {
    readonly xMin: number;
    readonly xMax: number;
    readonly yMin: number;
    readonly yMax: number;
    readonly zMin: number;
    readonly zMax: number;
    readonly maximum: number;
  };
  readonly surface: readonly [number, number, number];
  readonly normal: readonly [number, number];
  readonly volume: readonly [number, number, number];
  readonly iou: number;
}

export interface ComparisonGolden {
  readonly sourceReportSha256: string;
  readonly sourceNodeVersion: string;
  readonly referenceChecksum: string;
  readonly tolerances: GoldenTolerances;
  readonly cases: Readonly<Record<GoldenCaseName, GoldenCase>>;
}

export interface ParityDiagnosticEvidence {
  readonly semanticKey: string;
  readonly frameDeltas: {
    readonly controlPointDeltaMm: number;
    readonly xAxisDeltaDegrees: number;
    readonly zAxisDeltaDegrees: number;
  };
  readonly score: DiagnosticScore;
}

export interface ParityProgress {
  readonly index: number;
  readonly total: number;
  readonly semanticKey: string;
}

export interface ParitySummary {
  readonly referenceChecksum: string;
  readonly goldenSourceReportSha256: string;
  readonly productCount: number;
  readonly passingProductCount: number;
  readonly freshBatchProductCount: number;
  readonly representativeCases: readonly {
    readonly name: GoldenCaseName;
    readonly semanticKey: string;
  }[];
}

export interface FreshBatchComparisonOptions {
  readonly signal?: AbortSignal | undefined;
}

/** Read compact batch-CLI evidence captured independently from the Workbench runtime. */
export async function loadComparisonGolden(): Promise<ComparisonGolden> {
  const json = await readFile(
    new URL('../../tests/fixtures/comparisonCaseGolden.json', import.meta.url),
    'utf8'
  );
  return JSON.parse(json) as ComparisonGolden;
}

/** Run the actual batch comparison CLI and read its unique, newly written parity evidence. */
export async function runFreshBatchComparison(
  ifcPath: string,
  options: FreshBatchComparisonOptions = {}
): Promise<FreshBatchComparisonEvidence> {
  options.signal?.throwIfAborted();
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'infra-bridge-batch-parity-'));
  const evidencePath = join(temporaryDirectory, 'evidence.json');
  const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
  const comparisonEntry = fileURLToPath(
    new URL('../../scripts/compareInfraBridge.ts', import.meta.url)
  );
  try {
    await executeBatchComparison(
      packageRoot,
      comparisonEntry,
      ifcPath,
      evidencePath,
      options.signal
    );
    return parseFreshBatchComparisonEvidence(await readFile(evidencePath, 'utf8'));
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

/** Parse and validate the versioned evidence contract emitted by the batch CLI. */
export function parseFreshBatchComparisonEvidence(json: string): FreshBatchComparisonEvidence {
  const parsed: unknown = JSON.parse(json);
  if (
    !isRecord(parsed) ||
    parsed['schemaVersion'] !== 1 ||
    typeof parsed['referenceChecksum'] !== 'string' ||
    typeof parsed['productCount'] !== 'number' ||
    !Number.isInteger(parsed['productCount']) ||
    !isRecord(parsed['cases'])
  ) {
    throw new Error('The fresh batch evidence has an invalid top-level contract');
  }
  for (const [name, semanticKey] of typedEntries(REPRESENTATIVE_COMPARISON_KEYS)) {
    const comparisonCase = parsed['cases'][name];
    if (!isCompleteBatchDiagnostic(comparisonCase, semanticKey)) {
      throw new Error(`The fresh batch evidence is incomplete for ${name}: ${semanticKey}`);
    }
  }
  return parsed as unknown as FreshBatchComparisonEvidence;
}

/** Check every manifest product and the four representative batch evidence cases. */
export async function verifyWorkbenchParity(options: {
  readonly runtime: Pick<WorkbenchRuntime, 'catalog' | 'comparison'>;
  readonly onProgress?: ((progress: ParityProgress) => void) | undefined;
  readonly runFreshBatch?:
    | ((ifcPath: string, signal: AbortSignal | undefined) => Promise<FreshBatchComparisonEvidence>)
    | undefined;
  readonly signal?: AbortSignal | undefined;
}): Promise<ParitySummary> {
  const golden = await loadComparisonGolden();
  const catalog = await options.runtime.catalog();
  if (!catalog.ok) throw diagnosticFailure('catalog', catalog.error);
  if (catalog.value.reference.expectedChecksum !== golden.referenceChecksum) {
    throw new Error(
      `Reference checksum ${catalog.value.reference.expectedChecksum} does not match tracked golden ${golden.referenceChecksum}`
    );
  }
  const products = catalog.value.products;
  if (products.length !== EXPECTED_PRODUCT_COUNT) {
    throw new Error(
      `Expected ${String(EXPECTED_PRODUCT_COUNT)} selectable products, received ${String(products.length)}`
    );
  }
  const semanticKeys = products.map(({ semanticKey }) => semanticKey);
  if (new Set(semanticKeys).size !== semanticKeys.length) {
    throw new Error('Workbench catalog contains duplicate Semantic Keys');
  }

  const freshBatch =
    options.runFreshBatch === undefined
      ? await runFreshBatchComparison(catalog.value.reference.path, {
          signal: options.signal,
        })
      : await options.runFreshBatch(catalog.value.reference.path, options.signal);
  if (freshBatch.referenceChecksum !== catalog.value.reference.expectedChecksum) {
    throw new Error(
      `Fresh batch checksum ${freshBatch.referenceChecksum} does not match Workbench Reference ${catalog.value.reference.expectedChecksum}`
    );
  }
  if (freshBatch.productCount !== semanticKeys.length) {
    throw new Error(
      `Fresh batch compared ${String(freshBatch.productCount)} products, but the Workbench catalog contains ${String(semanticKeys.length)}`
    );
  }

  const representativeByKey = new Map(
    typedEntries(golden.cases).map(([name, comparisonCase]) => [
      comparisonCase.semanticKey,
      { name, comparisonCase, batchCase: freshBatch.cases[name] },
    ])
  );
  for (const [name, { semanticKey }] of typedEntries(golden.cases)) {
    if (!semanticKeys.includes(semanticKey)) {
      throw new Error(`Tracked representative Semantic Key is absent from catalog: ${semanticKey}`);
    }
    if (REPRESENTATIVE_COMPARISON_KEYS[name] !== semanticKey) {
      throw new Error(`Tracked ${name} Semantic Key does not match the batch evidence contract`);
    }
  }

  let passingProductCount = 0;
  for (const [index, semanticKey] of semanticKeys.entries()) {
    options.onProgress?.({ index: index + 1, total: semanticKeys.length, semanticKey });
    const result = await options.runtime.comparison(semanticKey);
    if (!result.ok) throw diagnosticFailure(semanticKey, result.error);
    if (result.value.semanticKey !== semanticKey) {
      throw new Error(
        `Requested ${semanticKey}, but the Workbench returned ${result.value.semanticKey}`
      );
    }
    if (!result.value.pass) {
      const failedGates = result.value.gates
        .filter(({ status }) => status === 'fail' || status === 'unavailable')
        .map(({ id }) => id)
        .join(', ');
      throw new Error(`Fidelity Gate failure for ${semanticKey}: ${failedGates}`);
    }
    passingProductCount += 1;
    const representative = representativeByKey.get(semanticKey);
    if (representative !== undefined) {
      assertComparisonMatchesGolden(result.value, representative.comparisonCase, golden.tolerances);
      assertComparisonMatchesBatch(result.value, representative.batchCase, golden.tolerances);
    }
  }

  return {
    referenceChecksum: golden.referenceChecksum,
    goldenSourceReportSha256: golden.sourceReportSha256,
    productCount: semanticKeys.length,
    passingProductCount,
    freshBatchProductCount: freshBatch.productCount,
    representativeCases: typedEntries(golden.cases).map(([name, comparisonCase]) => ({
      name,
      semanticKey: comparisonCase.semanticKey,
    })),
  };
}

/** Assert one current Workbench diagnostic agrees with its independently tracked batch evidence. */
export function assertComparisonMatchesGolden(
  actual: ParityDiagnosticEvidence,
  expected: GoldenCase,
  tolerances: GoldenTolerances
): void {
  if (actual.semanticKey !== expected.semanticKey) {
    throw new Error(`Expected ${expected.semanticKey}, received ${actual.semanticKey}`);
  }
  assertAbsoluteClose(
    actual.frameDeltas.controlPointDeltaMm,
    expected.frame[0],
    tolerances.frameAndEnvelopeMm,
    'frame control point'
  );
  assertAbsoluteClose(
    actual.frameDeltas.xAxisDeltaDegrees,
    expected.frame[1],
    tolerances.frameAndEnvelopeMm,
    'frame X axis'
  );
  assertAbsoluteClose(
    actual.frameDeltas.zAxisDeltaDegrees,
    expected.frame[2],
    tolerances.frameAndEnvelopeMm,
    'frame Z axis'
  );

  const envelope = actual.score.envelope;
  assertAbsoluteClose(
    envelope.deltasMm.xMin,
    expected.envelope.xMin,
    tolerances.frameAndEnvelopeMm,
    'envelope X minimum'
  );
  assertAbsoluteClose(
    envelope.deltasMm.xMax,
    expected.envelope.xMax,
    tolerances.frameAndEnvelopeMm,
    'envelope X maximum'
  );
  assertAbsoluteClose(
    envelope.deltasMm.yMin,
    expected.envelope.yMin,
    tolerances.frameAndEnvelopeMm,
    'envelope Y minimum'
  );
  assertAbsoluteClose(
    envelope.deltasMm.yMax,
    expected.envelope.yMax,
    tolerances.frameAndEnvelopeMm,
    'envelope Y maximum'
  );
  assertAbsoluteClose(
    envelope.deltasMm.zMin,
    expected.envelope.zMin,
    tolerances.frameAndEnvelopeMm,
    'envelope Z minimum'
  );
  assertAbsoluteClose(
    envelope.deltasMm.zMax,
    expected.envelope.zMax,
    tolerances.frameAndEnvelopeMm,
    'envelope Z maximum'
  );
  assertAbsoluteClose(
    envelope.maximumAbsoluteDeltaMm,
    expected.envelope.maximum,
    tolerances.frameAndEnvelopeMm,
    'envelope maximum'
  );

  const surface = actual.score.surfaceDistance;
  assertAbsoluteClose(
    surface.maximumMm,
    expected.surface[0],
    tolerances.surfaceMm,
    'surface maximum'
  );
  assertAbsoluteClose(surface.meanMm, expected.surface[1], tolerances.surfaceMm, 'surface mean');
  assertAbsoluteClose(surface.p95Mm, expected.surface[2], tolerances.surfaceMm, 'surface p95');
  assertAbsoluteClose(
    actual.score.normalAgreement.meanCosine,
    expected.normal[0],
    tolerances.ratio,
    'normal mean'
  );
  assertAbsoluteClose(
    actual.score.normalAgreement.minimumCosine,
    expected.normal[1],
    tolerances.ratio,
    'normal minimum'
  );

  const volume = actual.score.volume;
  if (volume === undefined) throw new Error('volume evidence is unavailable');
  assertRelativeClose(volume.targetMm3, expected.volume[0], tolerances.ratio, 'target volume');
  assertRelativeClose(
    volume.candidateMm3,
    expected.volume[1],
    tolerances.ratio,
    'candidate volume'
  );
  assertAbsoluteClose(
    volume.relativeError,
    expected.volume[2],
    tolerances.ratio,
    'volume relative error'
  );

  const iou = actual.score.closedSolidIoU;
  if (iou === undefined) throw new Error('closed-solid IoU evidence is unavailable');
  assertAbsoluteClose(iou.value, expected.iou, tolerances.voxel32IoU, 'closed-solid IoU');
}

/** Assert one current Workbench diagnostic agrees directly with a fresh batch-CLI diagnostic. */
export function assertComparisonMatchesBatch(
  actual: ParityDiagnosticEvidence,
  expected: ParityDiagnosticEvidence,
  tolerances: GoldenTolerances
): void {
  const volume = expected.score.volume;
  if (volume === undefined) throw new Error('fresh batch volume evidence is unavailable');
  const iou = expected.score.closedSolidIoU;
  if (iou === undefined) throw new Error('fresh batch closed-solid IoU evidence is unavailable');
  assertComparisonMatchesGolden(
    actual,
    {
      semanticKey: expected.semanticKey,
      frame: [
        expected.frameDeltas.controlPointDeltaMm,
        expected.frameDeltas.xAxisDeltaDegrees,
        expected.frameDeltas.zAxisDeltaDegrees,
      ],
      envelope: {
        ...expected.score.envelope.deltasMm,
        maximum: expected.score.envelope.maximumAbsoluteDeltaMm,
      },
      surface: [
        expected.score.surfaceDistance.maximumMm,
        expected.score.surfaceDistance.meanMm,
        expected.score.surfaceDistance.p95Mm,
      ],
      normal: [
        expected.score.normalAgreement.meanCosine,
        expected.score.normalAgreement.minimumCosine,
      ],
      volume: [volume.targetMm3, volume.candidateMm3, volume.relativeError],
      iou: iou.value,
    },
    tolerances
  );
}

function assertAbsoluteClose(
  actual: number,
  expected: number,
  tolerance: number,
  label: string
): void {
  const delta = Math.abs(actual - expected);
  if (!Number.isFinite(actual) || delta > tolerance) {
    throw new Error(
      `${label}: expected ${String(expected)} ± ${String(tolerance)}, received ${String(actual)}`
    );
  }
}

function assertRelativeClose(
  actual: number,
  expected: number,
  tolerance: number,
  label: string
): void {
  const relativeDelta = Math.abs(actual - expected) / Math.max(1, Math.abs(expected));
  if (!Number.isFinite(actual) || relativeDelta > tolerance) {
    throw new Error(
      `${label}: expected relative delta ≤ ${String(tolerance)}, received ${String(relativeDelta)}`
    );
  }
}

function diagnosticFailure(
  subject: string,
  diagnostic: {
    readonly stage: string;
    readonly code: string;
    readonly message: string;
    readonly action: string;
  }
): Error {
  return new Error(
    `${subject} failed at ${diagnostic.stage}/${diagnostic.code}: ${diagnostic.message}. ${diagnostic.action}`
  );
}

function executeBatchComparison(
  packageRoot: string,
  comparisonEntry: string,
  ifcPath: string,
  evidencePath: string,
  signal: AbortSignal | undefined
): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      ['--import', 'tsx', comparisonEntry, '--ifc', ifcPath, '--parity-evidence', evidencePath],
      {
        cwd: packageRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          TSX_TSCONFIG_PATH: join(packageRoot, 'tsconfig.compare.json'),
        },
        ...(signal === undefined ? {} : { signal }),
        timeout: 75_000,
        maxBuffer: 2 * 1_024 * 1_024,
      },
      (error, _stdout, stderr) => {
        if (error === null) {
          resolve();
          return;
        }
        const detail = stderr.trim();
        reject(
          new Error(
            `Fresh batch comparison failed: ${error.message}${detail.length > 0 ? `\n${detail}` : ''}`
          )
        );
      }
    );
  });
}

function isCompleteBatchDiagnostic(value: unknown, semanticKey: string): boolean {
  if (!isRecord(value) || value['semanticKey'] !== semanticKey) return false;
  const frame = value['frameDeltas'];
  const score = value['score'];
  if (!isRecord(frame) || !isRecord(score)) return false;
  const surface = score['surfaceDistance'];
  const normal = score['normalAgreement'];
  const envelope = score['envelope'];
  const volume = score['volume'];
  const iou = score['closedSolidIoU'];
  if (
    !isRecord(surface) ||
    !isRecord(normal) ||
    !isRecord(envelope) ||
    !isRecord(volume) ||
    !isRecord(iou)
  ) {
    return false;
  }
  const deltas = envelope['deltasMm'];
  if (!isRecord(deltas)) return false;
  const numbers = [
    frame['controlPointDeltaMm'],
    frame['xAxisDeltaDegrees'],
    frame['zAxisDeltaDegrees'],
    surface['maximumMm'],
    surface['meanMm'],
    surface['p95Mm'],
    surface['areaSampleCount'],
    normal['meanCosine'],
    normal['minimumCosine'],
    deltas['xMin'],
    deltas['xMax'],
    deltas['yMin'],
    deltas['yMax'],
    deltas['zMin'],
    deltas['zMax'],
    envelope['maximumAbsoluteDeltaMm'],
    volume['targetMm3'],
    volume['candidateMm3'],
    volume['relativeError'],
    iou['value'],
  ];
  return (
    numbers.every(isFiniteNumber) &&
    (iou['method'] === 'exact-envelope' || iou['method'] === 'voxel-32')
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function typedEntries<T extends Readonly<Record<string, unknown>>>(
  value: T
): { [K in keyof T]: readonly [K, T[K]] }[keyof T][] {
  return Object.entries(value) as { [K in keyof T]: readonly [K, T[K]] }[keyof T][];
}
