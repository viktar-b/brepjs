import { err, ok, type Result } from 'brepjs';
import type { BimError } from '../errors/bimError.js';
import { ifcError, specError } from '../errors/bimError.js';
import {
  BRIDGE_VALIDATION_GATES,
  buildBridgeValidationReport,
  classifyBridgeValidationExit,
  serializeBridgeValidationReport,
  type BridgeGateResultInput,
  type BridgeValidationExitClassification,
  type BridgeValidationReport,
} from './bridgeValidationContract.js';

export interface BridgeExportLock {
  readonly release: () => Promise<void>;
}

export interface BridgeExportFileSystem {
  readonly join: (...parts: readonly string[]) => string;
  readonly mkdir: (path: string) => Promise<void>;
  readonly mkdtemp: (prefix: string) => Promise<string>;
  readonly writeFile: (path: string, data: Uint8Array) => Promise<void>;
  readonly rename: (from: string, to: string) => Promise<void>;
  /** Atomically hard-links a staged file only when the target path is absent. */
  readonly linkFileNoReplace: (from: string, to: string) => Promise<void>;
  readonly unlinkFile: (path: string) => Promise<void>;
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
  readonly report: BridgeValidationReport;
  /** Host filesystem boundary; generated Node commands provide a thin adapter. */
  readonly fileSystem: BridgeExportFileSystem;
}

export interface ValidatedBridgeExportResult {
  readonly committed: boolean;
  readonly exitClassification: BridgeValidationExitClassification;
  readonly ifcPath: string;
  readonly reportPath: string;
}

/** Commits a matching IFC/report pair only after every required Bridge project gate passes. */
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

async function commitValidatedBridgeExportTransaction(
  input: ValidatedBridgeExportInput
): Promise<Result<ValidatedBridgeExportResult, BimError>> {
  if (
    input.outputDirectory.length === 0 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.projectKey) ||
    !(input.ifcBytes instanceof Uint8Array)
  ) {
    return err(
      specError(
        'BRIDGE_EXPORT_INPUT',
        'Bridge export requires an output directory, a kebab-case project key, and IFC bytes'
      )
    );
  }

  const ifcPath = input.fileSystem.join(input.outputDirectory, `${input.projectKey}.ifc`);
  const reportPath = input.fileSystem.join(input.outputDirectory, 'validation-report.json');
  const canonicalReport = rebuildCanonicalReport(input.report);
  const exitClassification =
    canonicalReport === null ? 2 : classifyBridgeValidationExit(canonicalReport);
  const result = { committed: false, exitClassification, ifcPath, reportPath } as const;
  if (exitClassification !== 0) return ok(result);
  if (canonicalReport === null) return ok({ ...result, exitClassification: 2 });

  const ifcBytes = Uint8Array.from(input.ifcBytes);
  const expectedModelHash = canonicalReport.modelHash.value;
  const reportBytes = new TextEncoder().encode(serializeBridgeValidationReport(canonicalReport));
  const actualHash = await sha256Hex(ifcBytes);
  if (actualHash !== expectedModelHash) {
    return err(
      ifcError(
        'BRIDGE_EXPORT_MODEL_HASH_MISMATCH',
        'Validation report model hash does not match the IFC bytes'
      )
    );
  }

  const fileSystem = input.fileSystem;
  await fileSystem.mkdir(input.outputDirectory);
  const lock = await fileSystem.acquireExclusiveLock(
    fileSystem.join(input.outputDirectory, '.brepjs-export.lock')
  );
  const stagingDirectory = await fileSystem.mkdtemp(
    fileSystem.join(input.outputDirectory, '.brepjs-export-')
  );
  const state: ExportTransactionState = {
    fileSystem,
    ifcPath,
    reportPath,
    stagedIfcPath: fileSystem.join(stagingDirectory, `${input.projectKey}.ifc`),
    stagedReportPath: fileSystem.join(stagingDirectory, 'validation-report.json'),
    previousIfcPath: fileSystem.join(stagingDirectory, 'previous.ifc'),
    previousReportPath: fileSystem.join(stagingDirectory, 'previous-validation-report.json'),
    backedUpIfc: false,
    backedUpReport: false,
    installedIfc: false,
    installedReport: false,
  };
  let preserveStaging = false;
  let transactionResult: Result<ValidatedBridgeExportResult, BimError>;

  try {
    await fileSystem.writeFile(state.stagedIfcPath, ifcBytes);
    await fileSystem.writeFile(state.stagedReportPath, reportBytes);
    const ifcTargetKind = await fileSystem.kind(ifcPath);
    const reportTargetKind = await fileSystem.kind(reportPath);
    if (ifcTargetKind === 'other' || reportTargetKind === 'other') {
      throw new ExportTargetChangedError();
    }
    if (ifcTargetKind === 'file') {
      await fileSystem.rename(ifcPath, state.previousIfcPath);
      state.backedUpIfc = true;
      if ((await fileSystem.kind(state.previousIfcPath)) !== 'file') {
        throw new ExportTargetChangedError();
      }
    }
    if (reportTargetKind === 'file') {
      await fileSystem.rename(reportPath, state.previousReportPath);
      state.backedUpReport = true;
      if ((await fileSystem.kind(state.previousReportPath)) !== 'file') {
        throw new ExportTargetChangedError();
      }
    }
    await fileSystem.linkFileNoReplace(state.stagedIfcPath, ifcPath);
    state.installedIfc = true;
    await fileSystem.linkFileNoReplace(state.stagedReportPath, reportPath);
    state.installedReport = true;
    transactionResult = ok({ committed: true, exitClassification: 0, ifcPath, reportPath });
  } catch (cause) {
    const rollbackFailures = await rollback(state);
    preserveStaging = rollbackFailures.length > 0;
    transactionResult = transactionError(cause, rollbackFailures, stagingDirectory);
  }

  try {
    await lock.release();
  } catch (cause) {
    const rollbackFailures =
      transactionResult.ok && transactionResult.value.committed ? await rollback(state) : [];
    preserveStaging ||= rollbackFailures.length > 0;
    transactionResult = err(
      ifcError(
        'BRIDGE_EXPORT_COMMIT_FAILED',
        rollbackFailures.length === 0
          ? 'Could not release the Bridge export lock; the candidate output was rolled back'
          : `Could not release the Bridge export lock or fully restore the prior pair: ${rollbackFailures.join('; ')}. Recovery files were preserved at ${stagingDirectory}`,
        cause
      )
    );
  }

  if (!preserveStaging) {
    await fileSystem.removeOwnedDirectory(stagingDirectory).catch(() => undefined);
  }
  return transactionResult;
}

interface ExportTransactionState {
  readonly fileSystem: BridgeExportFileSystem;
  readonly ifcPath: string;
  readonly reportPath: string;
  readonly stagedIfcPath: string;
  readonly stagedReportPath: string;
  readonly previousIfcPath: string;
  readonly previousReportPath: string;
  backedUpIfc: boolean;
  backedUpReport: boolean;
  installedIfc: boolean;
  installedReport: boolean;
}

async function rollback(input: ExportTransactionState): Promise<string[]> {
  const failures: string[] = [];
  if (input.installedReport)
    await attempt(() => input.fileSystem.unlinkFile(input.reportPath), failures);
  if (input.installedIfc) await attempt(() => input.fileSystem.unlinkFile(input.ifcPath), failures);
  if (input.backedUpIfc) {
    await attempt(
      () => restoreBackup(input.fileSystem, input.previousIfcPath, input.ifcPath),
      failures
    );
  }
  if (input.backedUpReport) {
    await attempt(
      () => restoreBackup(input.fileSystem, input.previousReportPath, input.reportPath),
      failures
    );
  }
  return failures;
}

async function restoreBackup(
  fileSystem: BridgeExportFileSystem,
  backupPath: string,
  targetPath: string
): Promise<void> {
  if ((await fileSystem.kind(targetPath)) !== 'missing') {
    throw new Error(`Refusing to overwrite a new owner target at ${targetPath}`);
  }
  await fileSystem.rename(backupPath, targetPath);
}

function transactionError(
  cause: unknown,
  rollbackFailures: readonly string[],
  stagingDirectory: string
): Result<never, BimError> {
  if (cause instanceof ExportTargetChangedError && rollbackFailures.length === 0) {
    return err(targetNotFileError());
  }
  return err(
    ifcError(
      'BRIDGE_EXPORT_COMMIT_FAILED',
      rollbackFailures.length === 0
        ? 'Could not atomically commit the validated IFC/report pair; prior output was restored'
        : `Could not commit or fully restore the IFC/report pair: ${rollbackFailures.join('; ')}. Recovery files were preserved at ${stagingDirectory}`,
      cause
    )
  );
}

async function attempt(action: () => Promise<void>, failures: string[]): Promise<void> {
  try {
    await action();
  } catch (cause) {
    failures.push(cause instanceof Error ? cause.message : String(cause));
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digestBytes = new Uint8Array(bytes.byteLength);
  digestBytes.set(bytes);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', digestBytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
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

function targetNotFileError(): BimError {
  return ifcError(
    'BRIDGE_EXPORT_TARGET_NOT_FILE',
    'Bridge export targets may be absent or regular files, but not directories, special files, or targets changed during commit'
  );
}

class ExportTargetChangedError extends Error {}
