import { err, ok, type Result } from 'brepjs';
import type { BimError } from '../errors/bimError.js';
import { ifcError, specError } from '../errors/bimError.js';
import {
  BRIDGE_VALIDATION_GATES,
  buildBridgeValidationReport,
  classifyBridgeValidationExit,
  serializeBridgeValidationReport,
  type BridgeGateResultInput,
  type BridgeValidationReport,
} from './bridgeValidationContract.js';

const POINTER_SCHEMA_VERSION = '1';
const GENERATION_PREFIX = '.brepjs-export-';
const executedReports = new WeakMap<BridgeValidationReport, string>();

export interface BridgeExportLock {
  /** Releases the exclusive writer lock. A rejection means ownership is unknown. */
  readonly release: () => Promise<void>;
}

export interface BridgeExportFileSystem {
  readonly join: (...parts: readonly string[]) => string;
  readonly basename: (path: string) => string;
  readonly mkdir: (path: string) => Promise<void>;
  readonly mkdtemp: (prefix: string) => Promise<string>;
  readonly writeFile: (path: string, data: Uint8Array) => Promise<void>;
  readonly readFile: (path: string) => Promise<Uint8Array>;
  /** Atomically replaces one pointer file; readers see either its old or new complete bytes. */
  readonly replaceFileAtomically: (from: string, to: string) => Promise<void>;
  /** Recursively removes only a directory returned by this adapter's mkdtemp call. */
  readonly removeOwnedDirectory: (path: string) => Promise<void>;
  readonly kind: (path: string) => Promise<'missing' | 'file' | 'other'>;
  /** Waits for an exclusive filesystem lock shared by all exporter processes. */
  readonly acquireExclusiveLock: (path: string) => Promise<BridgeExportLock>;
}

export interface ValidatedBridgeExportInput {
  readonly outputDirectory: string;
  readonly projectKey: string;
  readonly ifcBytes: Uint8Array;
  /** Must be the exact report returned by the package-internal executed-gate coordinator. */
  readonly report: BridgeValidationReport;
  /** Host filesystem boundary; generated Node commands provide a thin adapter. */
  readonly fileSystem: BridgeExportFileSystem;
}

export type ValidatedBridgeExportResult =
  | {
      readonly committed: false;
      readonly exitClassification: 1 | 2;
      readonly pointerPath: string;
      readonly generationDirectory: null;
      readonly ifcPath: null;
      readonly reportPath: null;
      readonly lockStatus: 'not-acquired';
    }
  | {
      readonly committed: true;
      readonly exitClassification: 0;
      readonly pointerPath: string;
      readonly generationDirectory: string;
      readonly ifcPath: string;
      readonly reportPath: string;
      /** Unknown means the pair committed, but releasing the writer lock rejected. */
      readonly lockStatus: 'released' | 'unknown';
    };

export interface ResolvedBridgeExport {
  readonly pointerPath: string;
  readonly generationDirectory: string;
  readonly ifcPath: string;
  readonly reportPath: string;
  readonly modelHash: string;
}

interface BridgeExportPointer {
  readonly schemaVersion: typeof POINTER_SCHEMA_VERSION;
  readonly projectKey: string;
  readonly generation: string;
  readonly modelHash: string;
}

/**
 * Records the exact bytes/report pair produced by the package-internal required-gate executor.
 *
 * @internal This is deliberately absent from the package root export. The public commit seam
 * rejects reports that have only been assembled through the public report-shape builder.
 */
export async function authorizeExecutedBridgeValidationForExport(
  ifcBytes: Uint8Array,
  report: BridgeValidationReport
): Promise<Result<void, BimError>> {
  const canonical = rebuildCanonicalReport(report);
  if (canonical === null) {
    return err(
      specError('BRIDGE_EXPORT_VALIDATION_NOT_EXECUTED', 'Validation report is not canonical')
    );
  }
  const hash = await sha256Hex(Uint8Array.from(ifcBytes));
  if (hash !== canonical.modelHash.value) {
    return err(
      ifcError(
        'BRIDGE_EXPORT_MODEL_HASH_MISMATCH',
        'Executed validation report model hash does not match the exact IFC bytes'
      )
    );
  }
  executedReports.set(report, hash);
  return ok(undefined);
}

/** Commits one immutable matching pair by atomically replacing its single resolver pointer. */
export async function commitValidatedBridgeExport(
  input: ValidatedBridgeExportInput
): Promise<Result<ValidatedBridgeExportResult, BimError>> {
  try {
    return await commitValidatedBridgeExportTransaction(input);
  } catch (cause) {
    return err(
      ifcError(
        'BRIDGE_EXPORT_COMMIT_FAILED',
        'Could not prepare the Bridge export transaction',
        cause
      )
    );
  }
}

/** Resolves and hash-checks exactly one committed generation pointer. */
export async function resolveCommittedBridgeExport(
  outputDirectory: string,
  projectKey: string,
  fileSystem: BridgeExportFileSystem
): Promise<Result<ResolvedBridgeExport, BimError>> {
  try {
    if (outputDirectory.length === 0 || !isProjectKey(projectKey)) {
      return err(
        specError('BRIDGE_EXPORT_INPUT', 'Bridge export resolution requires a safe project key')
      );
    }
    const pointerPath = fileSystem.join(outputDirectory, pointerName(projectKey));
    if ((await fileSystem.kind(pointerPath)) !== 'file') {
      return err(
        ifcError('BRIDGE_EXPORT_POINTER_MISSING', 'No committed Bridge export pointer exists')
      );
    }
    const pointer = parsePointer(await fileSystem.readFile(pointerPath), projectKey);
    if (!pointer.ok) return pointer;
    const generationDirectory = fileSystem.join(outputDirectory, pointer.value.generation);
    const ifcPath = fileSystem.join(generationDirectory, `${projectKey}.ifc`);
    const reportPath = fileSystem.join(generationDirectory, 'validation-report.json');
    if (
      (await fileSystem.kind(ifcPath)) !== 'file' ||
      (await fileSystem.kind(reportPath)) !== 'file'
    ) {
      return err(
        ifcError('BRIDGE_EXPORT_BUNDLE_INCOMPLETE', 'Committed Bridge export bundle is incomplete')
      );
    }
    const [ifcBytes, reportBytes] = await Promise.all([
      fileSystem.readFile(ifcPath),
      fileSystem.readFile(reportPath),
    ]);
    const ifcHash = await sha256Hex(ifcBytes);
    const reportHash = readReportModelHash(reportBytes);
    if (ifcHash !== pointer.value.modelHash || reportHash !== pointer.value.modelHash) {
      return err(
        ifcError(
          'BRIDGE_EXPORT_BUNDLE_MISMATCH',
          'Committed Bridge IFC/report identity does not match'
        )
      );
    }
    return ok({
      pointerPath,
      generationDirectory,
      ifcPath,
      reportPath,
      modelHash: pointer.value.modelHash,
    });
  } catch (cause) {
    return err(
      ifcError(
        'BRIDGE_EXPORT_RESOLUTION_FAILED',
        'Could not resolve the committed Bridge export',
        cause
      )
    );
  }
}

async function commitValidatedBridgeExportTransaction(
  input: ValidatedBridgeExportInput
): Promise<Result<ValidatedBridgeExportResult, BimError>> {
  if (
    input.outputDirectory.length === 0 ||
    !isProjectKey(input.projectKey) ||
    !(input.ifcBytes instanceof Uint8Array)
  ) {
    return err(
      specError(
        'BRIDGE_EXPORT_INPUT',
        'Bridge export requires an output directory, a kebab-case project key, and IFC bytes'
      )
    );
  }

  const fileSystem = input.fileSystem;
  const pointerPath = fileSystem.join(input.outputDirectory, pointerName(input.projectKey));
  const ifcBytes = Uint8Array.from(input.ifcBytes);
  const actualHash = await sha256Hex(ifcBytes);
  if (executedReports.get(input.report) !== actualHash) {
    return err(
      specError(
        'BRIDGE_EXPORT_VALIDATION_NOT_EXECUTED',
        'Bridge export requires the internal executed-gate result for these exact IFC bytes'
      )
    );
  }
  const canonicalReport = rebuildCanonicalReport(input.report);
  if (canonicalReport === null || canonicalReport.modelHash.value !== actualHash) {
    return err(
      specError(
        'BRIDGE_EXPORT_VALIDATION_NOT_EXECUTED',
        'Executed validation evidence is no longer canonical'
      )
    );
  }
  const exitClassification = classifyBridgeValidationExit(canonicalReport);
  if (exitClassification !== 0) {
    return ok({
      committed: false,
      exitClassification,
      pointerPath,
      generationDirectory: null,
      ifcPath: null,
      reportPath: null,
      lockStatus: 'not-acquired',
    });
  }

  const reportBytes = new TextEncoder().encode(serializeBridgeValidationReport(canonicalReport));
  await fileSystem.mkdir(input.outputDirectory);
  const lock = await fileSystem.acquireExclusiveLock(
    fileSystem.join(input.outputDirectory, '.brepjs-export.lock')
  );
  let stagingDirectory: string | null = null;
  let committedResult: Extract<ValidatedBridgeExportResult, { committed: true }> | null = null;
  let transactionError: BimError | null = null;

  try {
    stagingDirectory = await fileSystem.mkdtemp(
      fileSystem.join(input.outputDirectory, GENERATION_PREFIX)
    );
    const generation = fileSystem.basename(stagingDirectory);
    if (
      !generation.startsWith(GENERATION_PREFIX) ||
      generation.includes('/') ||
      generation.includes('\\')
    ) {
      throw new Error('Filesystem adapter returned an invalid generation basename');
    }
    const ifcPath = fileSystem.join(stagingDirectory, `${input.projectKey}.ifc`);
    const reportPath = fileSystem.join(stagingDirectory, 'validation-report.json');
    const stagedPointerPath = fileSystem.join(stagingDirectory, '.commit-pointer.json');
    await fileSystem.writeFile(ifcPath, ifcBytes);
    await fileSystem.writeFile(reportPath, reportBytes);
    await fileSystem.writeFile(
      stagedPointerPath,
      new TextEncoder().encode(
        serializePointer({
          schemaVersion: POINTER_SCHEMA_VERSION,
          projectKey: input.projectKey,
          generation,
          modelHash: actualHash,
        })
      )
    );
    if ((await fileSystem.kind(pointerPath)) === 'other') {
      throw new ExportPointerCollisionError();
    }
    await fileSystem.replaceFileAtomically(stagedPointerPath, pointerPath);
    committedResult = {
      committed: true,
      exitClassification: 0,
      pointerPath,
      generationDirectory: stagingDirectory,
      ifcPath,
      reportPath,
      lockStatus: 'released',
    };
  } catch (cause) {
    transactionError =
      cause instanceof ExportPointerCollisionError
        ? ifcError(
            'BRIDGE_EXPORT_TARGET_NOT_FILE',
            'Bridge export pointer must be absent or a regular file'
          )
        : ifcError(
            'BRIDGE_EXPORT_COMMIT_FAILED',
            'Could not publish the complete Bridge export bundle',
            cause
          );
  }

  let releaseError: unknown;
  try {
    await lock.release();
  } catch (cause) {
    releaseError = cause;
  }

  if (committedResult !== null) {
    if (releaseError !== undefined) {
      return ok({ ...committedResult, lockStatus: 'unknown' });
    }
    return ok(committedResult);
  }

  let cleanupError: unknown;
  if (stagingDirectory !== null) {
    try {
      await fileSystem.removeOwnedDirectory(stagingDirectory);
    } catch (cause) {
      cleanupError = cause;
    }
  }
  return err(
    combineTransactionFailures(
      transactionError ?? ifcError('BRIDGE_EXPORT_COMMIT_FAILED', 'Bridge export did not commit'),
      stagingDirectory,
      releaseError,
      cleanupError
    )
  );
}

function combineTransactionFailures(
  primary: BimError,
  stagingDirectory: string | null,
  releaseError: unknown,
  cleanupError: unknown
): BimError {
  const details = [
    primary.message,
    ...(releaseError === undefined
      ? []
      : [`writer lock release is uncertain: ${messageOf(releaseError)}`]),
    ...(cleanupError === undefined
      ? []
      : [
          `owned staging cleanup failed${stagingDirectory === null ? '' : ` at ${stagingDirectory}`}: ${messageOf(cleanupError)}`,
        ]),
  ];
  return ifcError(primary.code, details.join('; '), primary.cause);
}

function rebuildCanonicalReport(report: BridgeValidationReport): BridgeValidationReport | null {
  try {
    if (report.gates.length !== BRIDGE_VALIDATION_GATES.length) return null;
    const gateResults = report.gates.map((gate) => ({
      gateId: gate.id,
      status: gate.status,
      ...(gate.validatorId === null ? {} : { validatorId: gate.validatorId }),
      ...(gate.status === 'unavailable' && gate.unavailableReason !== null
        ? { unavailableReason: gate.unavailableReason }
        : {}),
      issues: gate.issues,
      evidence: gate.evidence,
    })) as BridgeGateResultInput[];
    const rebuilt = buildBridgeValidationReport({
      ifcSchema: report.ifc.schema,
      ifcView: report.ifc.view,
      modelHash: report.modelHash,
      validators: report.validators,
      gateResults,
    });
    if (!rebuilt.ok) return null;
    return serializeBridgeValidationReport(rebuilt.value) ===
      serializeBridgeValidationReport(report)
      ? rebuilt.value
      : null;
  } catch {
    return null;
  }
}

function parsePointer(
  bytes: Uint8Array,
  projectKey: string
): Result<BridgeExportPointer, BimError> {
  let candidate: unknown;
  try {
    candidate = JSON.parse(new TextDecoder().decode(bytes));
  } catch (cause) {
    return err(
      ifcError(
        'BRIDGE_EXPORT_POINTER_INVALID',
        'Committed Bridge export pointer is not JSON',
        cause
      )
    );
  }
  if (
    candidate === null ||
    typeof candidate !== 'object' ||
    !('schemaVersion' in candidate) ||
    candidate.schemaVersion !== POINTER_SCHEMA_VERSION ||
    !('projectKey' in candidate) ||
    candidate.projectKey !== projectKey ||
    !('generation' in candidate) ||
    typeof candidate.generation !== 'string' ||
    !candidate.generation.startsWith(GENERATION_PREFIX) ||
    candidate.generation.includes('/') ||
    candidate.generation.includes('\\') ||
    !('modelHash' in candidate) ||
    typeof candidate.modelHash !== 'string' ||
    !/^[0-9a-f]{64}$/.test(candidate.modelHash)
  ) {
    return err(
      ifcError(
        'BRIDGE_EXPORT_POINTER_INVALID',
        'Committed Bridge export pointer has an invalid shape'
      )
    );
  }
  return ok({
    schemaVersion: POINTER_SCHEMA_VERSION,
    projectKey,
    generation: candidate.generation,
    modelHash: candidate.modelHash,
  });
}

function readReportModelHash(bytes: Uint8Array): string | null {
  try {
    const candidate = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    if (
      candidate !== null &&
      typeof candidate === 'object' &&
      'modelHash' in candidate &&
      candidate.modelHash !== null &&
      typeof candidate.modelHash === 'object' &&
      'algorithm' in candidate.modelHash &&
      candidate.modelHash.algorithm === 'sha256' &&
      'value' in candidate.modelHash &&
      typeof candidate.modelHash.value === 'string'
    ) {
      return candidate.modelHash.value;
    }
  } catch {
    // Invalid report JSON is represented as a mismatched bundle.
  }
  return null;
}

function serializePointer(pointer: BridgeExportPointer): string {
  return `${JSON.stringify(pointer, null, 2)}\n`;
}

function pointerName(projectKey: string): string {
  return `${projectKey}.bridge-export.json`;
}

function isProjectKey(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const snapshot = Uint8Array.from(bytes);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', snapshot);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

class ExportPointerCollisionError extends Error {}
