import { err, ok, type Result } from 'brepjs';
import type { BimError } from '../errors/bimError.js';
import { ifcError, specError } from '../errors/bimError.js';
import {
  BRIDGE_VALIDATION_GATES,
  serializeBridgeValidationReport,
  type BridgeValidationExitClassification,
  type BridgeValidationReport,
} from './bridgeValidationContract.js';

export interface BridgeExportFileSystem {
  readonly join: (...parts: readonly string[]) => string;
  readonly mkdir: (path: string) => Promise<void>;
  readonly mkdtemp: (prefix: string) => Promise<string>;
  readonly writeFile: (path: string, data: Uint8Array) => Promise<void>;
  readonly rename: (from: string, to: string) => Promise<void>;
  readonly unlinkFile: (path: string) => Promise<void>;
  /** Recursively removes only a directory returned by this adapter's mkdtemp call. */
  readonly removeOwnedDirectory: (path: string) => Promise<void>;
  readonly kind: (path: string) => Promise<'missing' | 'file' | 'other'>;
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

  const ifcBytes = Uint8Array.from(input.ifcBytes);
  const expectedModelHash = input.report.modelHash.value;
  const reportBytes = new TextEncoder().encode(serializeBridgeValidationReport(input.report));
  const ifcPath = input.fileSystem.join(input.outputDirectory, `${input.projectKey}.ifc`);
  const reportPath = input.fileSystem.join(input.outputDirectory, 'validation-report.json');
  const exitClassification = classifyCompleteBridgeReport(input.report);
  const result = { committed: false, exitClassification, ifcPath, reportPath } as const;
  if (exitClassification !== 0) return ok(result);

  return withDestinationLock(reportPath, async () => {
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
    const ifcTargetKind = await fileSystem.kind(ifcPath);
    const reportTargetKind = await fileSystem.kind(reportPath);
    if (ifcTargetKind === 'other' || reportTargetKind === 'other') {
      return err(
        ifcError(
          'BRIDGE_EXPORT_TARGET_NOT_FILE',
          'Bridge export targets may be absent or regular files, but not directories or special files'
        )
      );
    }
    await fileSystem.mkdir(input.outputDirectory);
    const stagingDirectory = await fileSystem.mkdtemp(
      fileSystem.join(input.outputDirectory, '.brepjs-export-')
    );
    const stagedIfcPath = fileSystem.join(stagingDirectory, `${input.projectKey}.ifc`);
    const stagedReportPath = fileSystem.join(stagingDirectory, 'validation-report.json');
    const previousIfcPath = fileSystem.join(stagingDirectory, 'previous.ifc');
    const previousReportPath = fileSystem.join(stagingDirectory, 'previous-validation-report.json');
    let backedUpIfc = false;
    let backedUpReport = false;
    let installedIfc = false;
    let installedReport = false;
    let preserveStaging = false;

    try {
      await fileSystem.writeFile(stagedIfcPath, ifcBytes);
      await fileSystem.writeFile(stagedReportPath, reportBytes);
      if (ifcTargetKind === 'file') {
        await fileSystem.rename(ifcPath, previousIfcPath);
        backedUpIfc = true;
      }
      if (reportTargetKind === 'file') {
        await fileSystem.rename(reportPath, previousReportPath);
        backedUpReport = true;
      }
      await fileSystem.rename(stagedIfcPath, ifcPath);
      installedIfc = true;
      await fileSystem.rename(stagedReportPath, reportPath);
      installedReport = true;
      return ok({ committed: true, exitClassification: 0, ifcPath, reportPath });
    } catch (cause) {
      const rollbackFailures = await rollback({
        fileSystem,
        ifcPath,
        reportPath,
        previousIfcPath,
        previousReportPath,
        backedUpIfc,
        backedUpReport,
        installedIfc,
        installedReport,
      });
      preserveStaging = rollbackFailures.length > 0;
      return err(
        ifcError(
          'BRIDGE_EXPORT_COMMIT_FAILED',
          rollbackFailures.length === 0
            ? 'Could not atomically commit the validated IFC/report pair; prior output was restored'
            : `Could not commit or fully restore the IFC/report pair: ${rollbackFailures.join('; ')}. Recovery files were preserved at ${stagingDirectory}`,
          cause
        )
      );
    } finally {
      if (!preserveStaging) {
        await fileSystem.removeOwnedDirectory(stagingDirectory).catch(() => undefined);
      }
    }
  });
}

interface RollbackInput {
  readonly fileSystem: BridgeExportFileSystem;
  readonly ifcPath: string;
  readonly reportPath: string;
  readonly previousIfcPath: string;
  readonly previousReportPath: string;
  readonly backedUpIfc: boolean;
  readonly backedUpReport: boolean;
  readonly installedIfc: boolean;
  readonly installedReport: boolean;
}

async function rollback(input: RollbackInput): Promise<string[]> {
  const failures: string[] = [];
  if (input.installedReport)
    await attempt(() => input.fileSystem.unlinkFile(input.reportPath), failures);
  if (input.installedIfc) await attempt(() => input.fileSystem.unlinkFile(input.ifcPath), failures);
  if (input.backedUpIfc) {
    await attempt(() => input.fileSystem.rename(input.previousIfcPath, input.ifcPath), failures);
  }
  if (input.backedUpReport) {
    await attempt(
      () => input.fileSystem.rename(input.previousReportPath, input.reportPath),
      failures
    );
  }
  return failures;
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

function classifyCompleteBridgeReport(
  report: Pick<BridgeValidationReport, 'gates'>
): BridgeValidationExitClassification {
  if (report.gates.length !== BRIDGE_VALIDATION_GATES.length) return 2;
  let unavailable = false;
  for (const [index, definition] of BRIDGE_VALIDATION_GATES.entries()) {
    const gate = report.gates[index];
    if (
      gate === undefined ||
      gate.id !== definition.id ||
      gate.evidenceLayer !== definition.evidenceLayer ||
      gate.required !== definition.required
    ) {
      return 2;
    }
    if (!definition.required) continue;
    if (gate.status === 'fail') return 1;
    if (gate.status !== 'pass') unavailable = true;
  }
  return unavailable ? 2 : 0;
}

const destinationLocks = new Map<string, Promise<void>>();

async function withDestinationLock<T>(key: string, action: () => Promise<T>): Promise<T> {
  const previous = destinationLocks.get(key) ?? Promise.resolve();
  let release: (() => void) | undefined;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  destinationLocks.set(key, tail);
  await previous;
  try {
    return await action();
  } finally {
    release?.();
    if (destinationLocks.get(key) === tail) destinationLocks.delete(key);
  }
}
