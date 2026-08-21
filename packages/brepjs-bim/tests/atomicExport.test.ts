import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unwrap } from 'brepjs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BRIDGE_VALIDATION_GATES,
  buildBridgeValidationReport,
  commitValidatedBridgeExport,
  serializeBridgeValidationReport,
  type BridgeExportFileSystem,
  type BridgeGateResultInput,
  type BridgeValidationReport,
} from '../src/index.js';

const NODE_FILE_SYSTEM: BridgeExportFileSystem = {
  join,
  mkdir: async (path) => {
    await mkdir(path, { recursive: true });
  },
  mkdtemp,
  writeFile,
  rename,
  remove: (path) => rm(path, { recursive: true, force: true }),
  exists: async (path) => {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  },
};

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  );
});

async function temporaryOutput(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'brepjs-atomic-export-'));
  temporaryRoots.push(root);
  return join(root, 'dist');
}

function reportFor(
  ifcBytes: Uint8Array,
  status: 'pass' | 'fail' | 'unavailable' = 'pass'
): BridgeValidationReport {
  const firstRequiredGate = BRIDGE_VALIDATION_GATES.find((gate) => gate.required)?.id;
  if (firstRequiredGate === undefined) throw new Error('required Bridge gate missing');
  const gateResults: BridgeGateResultInput[] = BRIDGE_VALIDATION_GATES.filter(
    (gate) => gate.required
  ).map((gate) => {
    if (gate.id !== firstRequiredGate || status === 'pass') {
      return {
        gateId: gate.id,
        status: 'pass',
        validatorId: 'brepjs-bim',
        issues: [],
        evidence: [{ kind: 'model', value: gate.id }],
      };
    }
    if (status === 'fail') {
      return {
        gateId: gate.id,
        status,
        validatorId: 'brepjs-bim',
        issues: [{ severity: 'error', code: 'TEST_FAILURE', message: 'Deliberate failure' }],
        evidence: [{ kind: 'model', value: gate.id }],
      };
    }
    return {
      gateId: gate.id,
      status,
      validatorId: 'brepjs-bim',
      unavailableReason: 'missing',
      issues: [{ severity: 'error', code: 'TEST_UNAVAILABLE', message: 'Evidence missing' }],
      evidence: [],
    };
  });
  return unwrap(
    buildBridgeValidationReport({
      ifcSchema: 'IFC4X3_ADD2',
      ifcView: 'ReferenceView',
      modelHash: {
        algorithm: 'sha256',
        value: createHash('sha256').update(ifcBytes).digest('hex'),
      },
      validators: [{ id: 'brepjs-bim', name: 'brepjs-bim validators', version: '1' }],
      gateResults,
    })
  );
}

describe('atomic validated Bridge export', () => {
  it('commits one matching IFC and validation-report pair after every required gate passes', async () => {
    const outputDirectory = await temporaryOutput();
    const ifcBytes = new TextEncoder().encode('IFC4X3_ADD2 deterministic bytes');
    const report = reportFor(ifcBytes);

    const result = unwrap(
      await commitValidatedBridgeExport({
        outputDirectory,
        projectKey: 'test-bridge',
        ifcBytes,
        report,
        fileSystem: NODE_FILE_SYSTEM,
      })
    );

    expect(result).toEqual({
      committed: true,
      exitClassification: 0,
      ifcPath: join(outputDirectory, 'test-bridge.ifc'),
      reportPath: join(outputDirectory, 'validation-report.json'),
    });
    expect(new Uint8Array(await readFile(result.ifcPath))).toEqual(ifcBytes);
    expect(await readFile(result.reportPath, 'utf8')).toBe(serializeBridgeValidationReport(report));
  });

  it.each([
    ['fail', 1],
    ['unavailable', 2],
  ] as const)(
    'does not touch output for required %s evidence',
    async (status, exitClassification) => {
      const outputDirectory = await temporaryOutput();
      const ifcBytes = new TextEncoder().encode(`candidate ${status}`);

      const result = unwrap(
        await commitValidatedBridgeExport({
          outputDirectory,
          projectKey: 'test-bridge',
          ifcBytes,
          report: reportFor(ifcBytes, status),
          fileSystem: NODE_FILE_SYSTEM,
        })
      );

      expect(result).toMatchObject({ committed: false, exitClassification });
      await expect(access(outputDirectory)).rejects.toThrow();
    }
  );

  it('cleans owned staging and writes no artifact when a staged write fails', async () => {
    const outputDirectory = await temporaryOutput();
    const ifcBytes = new TextEncoder().encode('candidate write failure');
    let writes = 0;
    const failingFileSystem: BridgeExportFileSystem = {
      ...NODE_FILE_SYSTEM,
      writeFile: async (path, data) => {
        writes += 1;
        if (writes === 2) throw new Error('injected staged report write failure');
        await NODE_FILE_SYSTEM.writeFile(path, data);
      },
    };

    const result = await commitValidatedBridgeExport({
      outputDirectory,
      projectKey: 'test-bridge',
      ifcBytes,
      report: reportFor(ifcBytes),
      fileSystem: failingFileSystem,
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'BRIDGE_EXPORT_COMMIT_FAILED' },
    });
    expect(await readdir(outputDirectory)).toEqual([]);
  });

  it('preserves the prior successful pair when later validation fails or is unavailable', async () => {
    const outputDirectory = await temporaryOutput();
    const previousBytes = new TextEncoder().encode('previous successful IFC');
    const previousReport = reportFor(previousBytes);
    unwrap(
      await commitValidatedBridgeExport({
        outputDirectory,
        projectKey: 'test-bridge',
        ifcBytes: previousBytes,
        report: previousReport,
        fileSystem: NODE_FILE_SYSTEM,
      })
    );

    for (const status of ['fail', 'unavailable'] as const) {
      const candidateBytes = new TextEncoder().encode(`replacement ${status}`);
      const result = unwrap(
        await commitValidatedBridgeExport({
          outputDirectory,
          projectKey: 'test-bridge',
          ifcBytes: candidateBytes,
          report: reportFor(candidateBytes, status),
          fileSystem: NODE_FILE_SYSTEM,
        })
      );
      expect(result.committed).toBe(false);
      expect(new Uint8Array(await readFile(result.ifcPath))).toEqual(previousBytes);
      expect(await readFile(result.reportPath, 'utf8')).toBe(
        serializeBridgeValidationReport(previousReport)
      );
    }
  });

  it('rolls back both targets when the second replacement rename fails', async () => {
    const outputDirectory = await temporaryOutput();
    const previousBytes = new TextEncoder().encode('previous replacement-safe IFC');
    const previousReport = reportFor(previousBytes);
    const previous = unwrap(
      await commitValidatedBridgeExport({
        outputDirectory,
        projectKey: 'test-bridge',
        ifcBytes: previousBytes,
        report: previousReport,
        fileSystem: NODE_FILE_SYSTEM,
      })
    );
    const candidateBytes = new TextEncoder().encode('candidate replacement IFC');
    const failingFileSystem: BridgeExportFileSystem = {
      ...NODE_FILE_SYSTEM,
      rename: async (from, to) => {
        if (
          from.includes('.brepjs-export-') &&
          from.endsWith('validation-report.json') &&
          !from.endsWith('previous-validation-report.json') &&
          to === previous.reportPath
        ) {
          throw new Error('injected final report rename failure');
        }
        await NODE_FILE_SYSTEM.rename(from, to);
      },
    };

    const result = await commitValidatedBridgeExport({
      outputDirectory,
      projectKey: 'test-bridge',
      ifcBytes: candidateBytes,
      report: reportFor(candidateBytes),
      fileSystem: failingFileSystem,
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'BRIDGE_EXPORT_COMMIT_FAILED' },
    });
    expect(new Uint8Array(await readFile(previous.ifcPath))).toEqual(previousBytes);
    expect(await readFile(previous.reportPath, 'utf8')).toBe(
      serializeBridgeValidationReport(previousReport)
    );
    expect(await readdir(outputDirectory)).toEqual(['test-bridge.ifc', 'validation-report.json']);
  });

  it('rejects a passing report whose model hash does not match the candidate IFC bytes', async () => {
    const outputDirectory = await temporaryOutput();
    const reportedBytes = new TextEncoder().encode('reported IFC');
    const differentBytes = new TextEncoder().encode('different IFC');

    const result = await commitValidatedBridgeExport({
      outputDirectory,
      projectKey: 'test-bridge',
      ifcBytes: differentBytes,
      report: reportFor(reportedBytes),
      fileSystem: NODE_FILE_SYSTEM,
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'BRIDGE_EXPORT_MODEL_HASH_MISMATCH' },
    });
    await expect(access(outputDirectory)).rejects.toThrow();
  });

  it('returns a Result error rather than rejecting for malformed runtime input', async () => {
    await expect(
      commitValidatedBridgeExport({} as Parameters<typeof commitValidatedBridgeExport>[0])
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'BRIDGE_EXPORT_COMMIT_FAILED' },
    });
  });
});
