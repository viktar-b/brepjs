import { err, ok, type Result } from 'brepjs';
import type { BimError } from '../errors/bimError.js';
import { ifcError, specError } from '../errors/bimError.js';
import {
  classifyBridgeValidationExit,
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
  readonly remove: (path: string) => Promise<void>;
  readonly exists: (path: string) => Promise<boolean>;
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
  const exitClassification = classifyBridgeValidationExit(input.report);
  const result = { committed: false, exitClassification, ifcPath, reportPath } as const;
  if (exitClassification !== 0) return ok(result);

  const actualHash = await sha256Hex(input.ifcBytes);
  if (actualHash !== input.report.modelHash.value) {
    return err(
      ifcError(
        'BRIDGE_EXPORT_MODEL_HASH_MISMATCH',
        'Validation report model hash does not match the IFC bytes'
      )
    );
  }

  const fileSystem = input.fileSystem;
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

  try {
    await fileSystem.writeFile(stagedIfcPath, input.ifcBytes);
    await fileSystem.writeFile(
      stagedReportPath,
      new TextEncoder().encode(serializeBridgeValidationReport(input.report))
    );
    if (await fileSystem.exists(ifcPath)) {
      await fileSystem.rename(ifcPath, previousIfcPath);
      backedUpIfc = true;
    }
    if (await fileSystem.exists(reportPath)) {
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
    return err(
      ifcError(
        'BRIDGE_EXPORT_COMMIT_FAILED',
        rollbackFailures.length === 0
          ? 'Could not atomically commit the validated IFC/report pair; prior output was restored'
          : `Could not commit or fully restore the IFC/report pair: ${rollbackFailures.join('; ')}`,
        cause
      )
    );
  } finally {
    await fileSystem.remove(stagingDirectory).catch(() => undefined);
  }
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
    await attempt(() => input.fileSystem.remove(input.reportPath), failures);
  if (input.installedIfc) await attempt(() => input.fileSystem.remove(input.ifcPath), failures);
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
