import { err, ok, type Result } from 'brepjs';
import type { BimError } from '../errors/bimError.js';
import { ifcError, specError } from '../errors/bimError.js';
import {
  BRIDGE_VALIDATION_GATES,
  buildBridgeValidationReport,
  classifyBridgeValidationExit,
  serializeBridgeValidationReport,
  type BridgeGateResultInput,
  type ValidationEvidenceReference,
  type ValidatorProvenance,
  type BridgeValidationReport,
} from './bridgeValidationContract.js';
import type { ValidationIssue } from './severity.js';

const POINTER_SCHEMA_VERSION = '1';
const GENERATION_PREFIX = '.brepjs-export-';
const executedValidations = new WeakMap<ExecutedBridgeValidation, ExecutedValidationRecord>();

interface ExecutedValidationRecord {
  readonly ifcBytes: Uint8Array;
  readonly reportBytes: Uint8Array;
  readonly modelHash: string;
  readonly reportHash: string;
}

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
  readonly readLink: (path: string) => Promise<string | null>;
  readonly createSymlinkNoReplace: (target: string, path: string) => Promise<void>;
  readonly removeOwnedLink: (path: string) => Promise<void>;
  readonly listDirectory: (path: string) => Promise<readonly string[]>;
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
  /** Opaque exact-byte result returned by executeBridgeValidationForExport. */
  readonly validation: ExecutedBridgeValidation;
  /** Host filesystem boundary; generated Node commands provide a thin adapter. */
  readonly fileSystem: BridgeExportFileSystem;
}

export interface ExecutedBridgeValidation {
  readonly report: BridgeValidationReport;
}

export type BridgeProjectGateExecution =
  | {
      readonly status: 'pass' | 'fail';
      readonly issues: readonly ValidationIssue[];
      readonly evidence: readonly ValidationEvidenceReference[];
    }
  | {
      readonly status: 'unavailable';
      readonly unavailableReason: 'unsupported' | 'skipped' | 'missing' | 'crashed';
      readonly issues: readonly ValidationIssue[];
      readonly evidence: readonly ValidationEvidenceReference[];
    };

export interface BridgeProjectGateRunner {
  readonly gateId: string;
  readonly validator: ValidatorProvenance;
  readonly run: (input: {
    /** Isolated copy of the exact immutable IFC candidate bytes. */
    readonly ifcBytes: Uint8Array;
  }) => Promise<BridgeProjectGateExecution>;
}

export interface ExecuteBridgeValidationInput {
  readonly ifcBytes: Uint8Array;
  readonly runners: readonly BridgeProjectGateRunner[];
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
      /** At most current+previous generations remain when complete. */
      readonly cleanupStatus: 'complete' | 'incomplete';
    };

export interface ResolvedBridgeExport {
  readonly pointerPath: string;
  readonly generationDirectory: string;
  readonly ifcPath: string;
  readonly reportPath: string;
  readonly modelHash: string;
  readonly reportHash: string;
}

interface BridgeExportPointer {
  readonly schemaVersion: typeof POINTER_SCHEMA_VERSION;
  readonly projectKey: string;
  readonly generation: string;
  readonly modelHash: string;
  readonly reportHash: string;
}

/** Executes every required project gate against one exact IFC snapshot and mints an opaque result. */
export async function executeBridgeValidationForExport(
  input: ExecuteBridgeValidationInput
): Promise<Result<ExecutedBridgeValidation, BimError>> {
  try {
    if (!(input.ifcBytes instanceof Uint8Array) || !Array.isArray(input.runners)) {
      return err(specError('BRIDGE_EXPORT_VALIDATION_INPUT', 'Gate execution input is malformed'));
    }
    const required = BRIDGE_VALIDATION_GATES.filter((gate) => gate.required);
    const runners = new Map<string, BridgeProjectGateRunner>();
    const validators = new Map<string, ValidatorProvenance>();
    const inputRunners: readonly BridgeProjectGateRunner[] = input.runners;
    for (const runner of inputRunners) {
      if (
        runner === null ||
        typeof runner !== 'object' ||
        typeof runner.gateId !== 'string' ||
        typeof runner.run !== 'function' ||
        runner.validator === null ||
        typeof runner.validator !== 'object' ||
        typeof runner.validator.id !== 'string' ||
        runner.validator.id.length === 0 ||
        typeof runner.validator.name !== 'string' ||
        runner.validator.name.length === 0 ||
        typeof runner.validator.version !== 'string' ||
        runner.validator.version.length === 0 ||
        runners.has(runner.gateId)
      ) {
        return err(
          specError(
            'BRIDGE_EXPORT_VALIDATION_INPUT',
            'Gate runner registry is malformed or duplicated'
          )
        );
      }
      runners.set(runner.gateId, runner);
      const prior = validators.get(runner.validator.id);
      if (prior !== undefined && JSON.stringify(prior) !== JSON.stringify(runner.validator)) {
        return err(
          specError('BRIDGE_EXPORT_VALIDATION_INPUT', 'Validator provenance is inconsistent')
        );
      }
      validators.set(runner.validator.id, runner.validator);
    }
    if (
      runners.size !== required.length ||
      required.some((definition) => !runners.has(definition.id))
    ) {
      return err(
        specError(
          'BRIDGE_EXPORT_VALIDATION_INPUT',
          'Exactly one runner is required for every required Bridge project gate'
        )
      );
    }

    const ifcBytes = Uint8Array.from(input.ifcBytes);
    const gateResults: BridgeGateResultInput[] = [];
    for (const definition of required) {
      const runner = runners.get(definition.id);
      if (runner === undefined) throw new Error(`Missing runner for ${definition.id}`);
      let execution: BridgeProjectGateExecution;
      try {
        execution = await runner.run({ ifcBytes: Uint8Array.from(ifcBytes) });
      } catch (cause) {
        execution = {
          status: 'unavailable',
          unavailableReason: 'crashed',
          issues: [
            {
              severity: 'error',
              code: 'VALIDATOR_CRASHED',
              message: `Required gate "${definition.id}" crashed: ${messageOf(cause)}`,
            },
          ],
          evidence: [],
        };
      }
      gateResults.push({
        gateId: definition.id,
        validatorId: runner.validator.id,
        ...execution,
      });
    }
    const modelHash = await sha256Hex(ifcBytes);
    const reportResult = buildBridgeValidationReport({
      ifcSchema: 'IFC4X3_ADD2',
      ifcView: 'ReferenceView',
      modelHash: { algorithm: 'sha256', value: modelHash },
      validators: [...validators.values()],
      gateResults,
    });
    if (!reportResult.ok) return reportResult;
    const reportBytes = new TextEncoder().encode(
      serializeBridgeValidationReport(reportResult.value)
    );
    const validation = Object.freeze({ report: reportResult.value });
    executedValidations.set(validation, {
      ifcBytes,
      reportBytes,
      modelHash,
      reportHash: await sha256Hex(reportBytes),
    });
    return ok(validation);
  } catch (cause) {
    return err(
      specError('BRIDGE_EXPORT_VALIDATION_INPUT', 'Could not execute required Bridge gates', cause)
    );
  }
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
    const pointerPath = fileSystem.join(outputDirectory, pointerName());
    const generation = await fileSystem.readLink(pointerPath);
    if (generation === null) {
      return err(
        ifcError('BRIDGE_EXPORT_POINTER_MISSING', 'No committed Bridge export pointer exists')
      );
    }
    if (!isGenerationName(generation)) {
      return err(
        ifcError('BRIDGE_EXPORT_POINTER_INVALID', 'Committed Bridge generation link is invalid')
      );
    }
    const generationDirectory = fileSystem.join(outputDirectory, generation);
    const pointer = parsePointer(
      await fileSystem.readFile(fileSystem.join(generationDirectory, 'bundle-manifest.json')),
      projectKey
    );
    if (!pointer.ok) return pointer;
    if (pointer.value.generation !== generation) {
      return err(
        ifcError(
          'BRIDGE_EXPORT_POINTER_INVALID',
          'Bundle manifest generation does not match the current link'
        )
      );
    }
    const generationIfcPath = fileSystem.join(generationDirectory, `${projectKey}.ifc`);
    const generationReportPath = fileSystem.join(generationDirectory, 'validation-report.json');
    if (
      (await fileSystem.kind(generationIfcPath)) !== 'file' ||
      (await fileSystem.kind(generationReportPath)) !== 'file'
    ) {
      return err(
        ifcError('BRIDGE_EXPORT_BUNDLE_INCOMPLETE', 'Committed Bridge export bundle is incomplete')
      );
    }
    const [ifcBytes, reportBytes] = await Promise.all([
      fileSystem.readFile(generationIfcPath),
      fileSystem.readFile(generationReportPath),
    ]);
    const ifcHash = await sha256Hex(ifcBytes);
    const reportHash = await sha256Hex(reportBytes);
    const declaredModelHash = readReportModelHash(reportBytes);
    if (
      ifcHash !== pointer.value.modelHash ||
      reportHash !== pointer.value.reportHash ||
      declaredModelHash !== pointer.value.modelHash
    ) {
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
      ifcPath: fileSystem.join(outputDirectory, `${projectKey}.ifc`),
      reportPath: fileSystem.join(outputDirectory, 'validation-report.json'),
      modelHash: pointer.value.modelHash,
      reportHash: pointer.value.reportHash,
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
  if (input.outputDirectory.length === 0 || !isProjectKey(input.projectKey)) {
    return err(
      specError(
        'BRIDGE_EXPORT_INPUT',
        'Bridge export requires an output directory, a kebab-case project key, and IFC bytes'
      )
    );
  }

  const fileSystem = input.fileSystem;
  const pointerPath = fileSystem.join(input.outputDirectory, pointerName());
  const directIfcPath = fileSystem.join(input.outputDirectory, `${input.projectKey}.ifc`);
  const directReportPath = fileSystem.join(input.outputDirectory, 'validation-report.json');
  const executed = executedValidations.get(input.validation);
  if (executed === undefined) {
    return err(
      specError(
        'BRIDGE_EXPORT_VALIDATION_NOT_EXECUTED',
        'Bridge export requires the opaque result returned by executeBridgeValidationForExport'
      )
    );
  }
  const { ifcBytes, reportBytes, modelHash, reportHash } = executed;
  const exitClassification = classifyBridgeValidationExit(input.validation.report);
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

  await fileSystem.mkdir(input.outputDirectory);
  const lock = await fileSystem.acquireExclusiveLock(
    fileSystem.join(input.outputDirectory, '.brepjs-export.lock')
  );
  let stagingDirectory: string | null = null;
  let committedResult: Extract<ValidatedBridgeExportResult, { committed: true }> | null = null;
  let candidatePointer: BridgeExportPointer | null = null;
  let candidateResult: Extract<ValidatedBridgeExportResult, { committed: true }> | null = null;
  let transactionError: BimError | null = null;
  let preserveGeneration = false;
  let stagedPointerPath: string | null = null;
  const createdStableLinks: string[] = [];
  let previousGeneration: string | null = null;

  try {
    const ifcLinkTarget = fileSystem.join(pointerName(), `${input.projectKey}.ifc`);
    const reportLinkTarget = fileSystem.join(pointerName(), 'validation-report.json');
    if (await ensureStableLink(fileSystem, directIfcPath, ifcLinkTarget)) {
      createdStableLinks.push(directIfcPath);
    }
    if (await ensureStableLink(fileSystem, directReportPath, reportLinkTarget)) {
      createdStableLinks.push(directReportPath);
    }
    try {
      previousGeneration = await fileSystem.readLink(pointerPath);
    } catch (cause) {
      throw new ExportPointerCollisionError(undefined, { cause });
    }
    if (previousGeneration !== null && !isGenerationName(previousGeneration)) {
      throw new ExportPointerCollisionError();
    }
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
    const generationIfcPath = fileSystem.join(stagingDirectory, `${input.projectKey}.ifc`);
    const generationReportPath = fileSystem.join(stagingDirectory, 'validation-report.json');
    stagedPointerPath = fileSystem.join(input.outputDirectory, `.${generation}.current-link`);
    await fileSystem.writeFile(generationIfcPath, ifcBytes);
    await fileSystem.writeFile(generationReportPath, reportBytes);
    candidatePointer = {
      schemaVersion: POINTER_SCHEMA_VERSION,
      projectKey: input.projectKey,
      generation,
      modelHash,
      reportHash,
    };
    candidateResult = {
      committed: true,
      exitClassification: 0,
      pointerPath,
      generationDirectory: stagingDirectory,
      ifcPath: directIfcPath,
      reportPath: directReportPath,
      lockStatus: 'released',
      cleanupStatus: 'complete',
    };
    await fileSystem.writeFile(
      fileSystem.join(stagingDirectory, 'bundle-manifest.json'),
      new TextEncoder().encode(serializePointer(candidatePointer))
    );
    await fileSystem.createSymlinkNoReplace(generation, stagedPointerPath);
    await fileSystem.replaceFileAtomically(stagedPointerPath, pointerPath);
    stagedPointerPath = null;
    committedResult = candidateResult;
  } catch (cause) {
    if (
      !(cause instanceof ExportPointerCollisionError) &&
      candidatePointer !== null &&
      candidateResult !== null
    ) {
      const pointerState = await reconcilePointer(fileSystem, pointerPath, candidatePointer);
      if (pointerState === 'committed') {
        committedResult = candidateResult;
        stagedPointerPath = null;
      }
      if (pointerState === 'unknown') preserveGeneration = true;
    }
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

  if (committedResult !== null && candidatePointer !== null) {
    try {
      await cleanupOldGenerations(
        fileSystem,
        input.outputDirectory,
        candidatePointer.generation,
        previousGeneration
      );
    } catch {
      committedResult = { ...committedResult, cleanupStatus: 'incomplete' };
    }
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
  if (stagedPointerPath !== null) {
    try {
      await fileSystem.removeOwnedLink(stagedPointerPath);
    } catch (cause) {
      cleanupError = cause;
    }
  }
  if (stagingDirectory !== null && !preserveGeneration) {
    try {
      await fileSystem.removeOwnedDirectory(stagingDirectory);
    } catch (cause) {
      cleanupError = cause;
    }
  }
  if ((await fileSystem.readLink(pointerPath).catch(() => null)) === null) {
    for (const path of createdStableLinks.reverse()) {
      await fileSystem.removeOwnedLink(path).catch(() => undefined);
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
    !/^[0-9a-f]{64}$/.test(candidate.modelHash) ||
    !('reportHash' in candidate) ||
    typeof candidate.reportHash !== 'string' ||
    !/^[0-9a-f]{64}$/.test(candidate.reportHash)
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
    reportHash: candidate.reportHash,
  });
}

async function reconcilePointer(
  fileSystem: BridgeExportFileSystem,
  pointerPath: string,
  candidate: BridgeExportPointer
): Promise<'committed' | 'not-committed' | 'unknown'> {
  try {
    const generation = await fileSystem.readLink(pointerPath);
    if (generation === null) return 'not-committed';
    return generation === candidate.generation ? 'committed' : 'not-committed';
  } catch {
    return 'unknown';
  }
}

async function ensureStableLink(
  fileSystem: BridgeExportFileSystem,
  path: string,
  target: string
): Promise<boolean> {
  const existing = await fileSystem.readLink(path);
  if (existing === target) return false;
  if (existing !== null) throw new ExportPointerCollisionError();
  try {
    await fileSystem.createSymlinkNoReplace(target, path);
    return true;
  } catch (cause) {
    const raced = await fileSystem.readLink(path);
    if (raced === target) return false;
    throw new ExportPointerCollisionError(undefined, { cause });
  }
}

async function cleanupOldGenerations(
  fileSystem: BridgeExportFileSystem,
  outputDirectory: string,
  currentGeneration: string,
  previousGeneration: string | null
): Promise<void> {
  const keep = new Set([
    currentGeneration,
    ...(previousGeneration === null ? [] : [previousGeneration]),
  ]);
  const entries = await fileSystem.listDirectory(outputDirectory);
  for (const entry of entries) {
    if (isGenerationName(entry) && !keep.has(entry)) {
      await fileSystem.removeOwnedDirectory(fileSystem.join(outputDirectory, entry));
    }
  }
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

function pointerName(): string {
  return '.brepjs-current';
}

function isGenerationName(value: string): boolean {
  return value.startsWith(GENERATION_PREFIX) && !value.includes('/') && !value.includes('\\');
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
