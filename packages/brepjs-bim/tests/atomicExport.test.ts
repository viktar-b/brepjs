import { createHash } from 'node:crypto';
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, relative } from 'node:path';
import { unwrap } from 'brepjs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BRIDGE_VALIDATION_GATES,
  buildBridgeValidationReport,
  commitValidatedBridgeExport,
  resolveCommittedBridgeExport,
  serializeBridgeValidationReport,
  type BridgeExportFileSystem,
  type BridgeGateResultInput,
  type BridgeValidationReport,
} from '../src/index.js';
import { authorizeExecutedBridgeValidationForExport } from '../src/validation/atomicBridgeExport.js';

const NODE_FILE_SYSTEM: BridgeExportFileSystem = {
  join,
  basename,
  mkdir: async (path) => {
    await mkdir(path, { recursive: true });
  },
  mkdtemp,
  writeFile,
  readFile,
  replaceFileAtomically: rename,
  removeOwnedDirectory: (path) => rm(path, { recursive: true, force: true }),
  kind: async (path) => {
    try {
      return (await lstat(path)).isFile() ? 'file' : 'other';
    } catch (cause) {
      if (
        cause !== null &&
        typeof cause === 'object' &&
        'code' in cause &&
        cause.code === 'ENOENT'
      ) {
        return 'missing';
      }
      throw cause;
    }
  },
  acquireExclusiveLock: async (path) => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      try {
        const handle = await open(path, 'wx');
        return {
          release: async () => {
            await handle.close();
            await rm(path, { force: true });
          },
        };
      } catch (cause) {
        if (
          cause === null ||
          typeof cause !== 'object' ||
          !('code' in cause) ||
          cause.code !== 'EEXIST'
        ) {
          throw cause;
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }
    throw new Error(`Timed out acquiring Bridge export lock at ${path}`);
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

function buildReportFor(
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

async function executedReportFor(
  ifcBytes: Uint8Array,
  status: 'pass' | 'fail' | 'unavailable' = 'pass'
): Promise<BridgeValidationReport> {
  const report = buildReportFor(ifcBytes, status);
  unwrap(await authorizeExecutedBridgeValidationForExport(ifcBytes, report));
  return report;
}

describe('atomic validated Bridge export', () => {
  it('publishes one immutable bundle through one atomically replaced pointer', async () => {
    const outputDirectory = await temporaryOutput();
    const ifcBytes = new TextEncoder().encode('IFC4X3_ADD2 deterministic bytes');
    const report = await executedReportFor(ifcBytes);

    const result = unwrap(
      await commitValidatedBridgeExport({
        outputDirectory,
        projectKey: 'test-bridge',
        ifcBytes,
        report,
        fileSystem: NODE_FILE_SYSTEM,
      })
    );

    expect(result).toMatchObject({
      committed: true,
      exitClassification: 0,
      pointerPath: join(outputDirectory, 'test-bridge.bridge-export.json'),
      lockStatus: 'released',
    });
    if (!result.committed) throw new Error('expected committed export');
    const resolved = unwrap(
      await resolveCommittedBridgeExport(outputDirectory, 'test-bridge', NODE_FILE_SYSTEM)
    );
    expect(resolved).toMatchObject({
      generationDirectory: result.generationDirectory,
      ifcPath: result.ifcPath,
      reportPath: result.reportPath,
      modelHash: report.modelHash.value,
    });
    expect(new Uint8Array(await readFile(resolved.ifcPath))).toEqual(ifcBytes);
    expect(await readFile(resolved.reportPath, 'utf8')).toBe(
      serializeBridgeValidationReport(report)
    );
  });

  it.each([
    ['fail', 1],
    ['unavailable', 2],
  ] as const)(
    'does not publish a pointer for required %s evidence',
    async (status, expectedExit) => {
      const outputDirectory = await temporaryOutput();
      const ifcBytes = new TextEncoder().encode(`candidate ${status}`);

      const result = unwrap(
        await commitValidatedBridgeExport({
          outputDirectory,
          projectKey: 'test-bridge',
          ifcBytes,
          report: await executedReportFor(ifcBytes, status),
          fileSystem: NODE_FILE_SYSTEM,
        })
      );

      expect(result).toMatchObject({
        committed: false,
        exitClassification: expectedExit,
        lockStatus: 'not-acquired',
      });
      await expect(access(outputDirectory)).rejects.toThrow();
    }
  );

  it('rejects a fabricated all-pass report at the public production seam', async () => {
    const outputDirectory = await temporaryOutput();
    const ifcBytes = new TextEncoder().encode('arbitrary unvalidated bytes');

    const result = await commitValidatedBridgeExport({
      outputDirectory,
      projectKey: 'test-bridge',
      ifcBytes,
      report: buildReportFor(ifcBytes),
      fileSystem: NODE_FILE_SYSTEM,
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'BRIDGE_EXPORT_VALIDATION_NOT_EXECUTED' },
    });
    await expect(access(outputDirectory)).rejects.toThrow();
  });

  it('does not transfer executed-validation authority to a report clone', async () => {
    const outputDirectory = await temporaryOutput();
    const ifcBytes = new TextEncoder().encode('authorized report identity');
    const report = await executedReportFor(ifcBytes);

    const result = await commitValidatedBridgeExport({
      outputDirectory,
      projectKey: 'test-bridge',
      ifcBytes,
      report: { ...report },
      fileSystem: NODE_FILE_SYSTEM,
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'BRIDGE_EXPORT_VALIDATION_NOT_EXECUTED' },
    });
  });

  it('rejects executed validation when the exact IFC bytes differ', async () => {
    const outputDirectory = await temporaryOutput();
    const reportedBytes = new TextEncoder().encode('reported IFC');

    const result = await commitValidatedBridgeExport({
      outputDirectory,
      projectKey: 'test-bridge',
      ifcBytes: new TextEncoder().encode('different IFC'),
      report: await executedReportFor(reportedBytes),
      fileSystem: NODE_FILE_SYSTEM,
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'BRIDGE_EXPORT_VALIDATION_NOT_EXECUTED' },
    });
  });

  it('returns a Result error rather than rejecting for malformed runtime input', async () => {
    await expect(
      commitValidatedBridgeExport({} as Parameters<typeof commitValidatedBridgeExport>[0])
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'BRIDGE_EXPORT_COMMIT_FAILED' },
    });
  });

  it('cleans an unpublished generation when staged report writing fails', async () => {
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
      report: await executedReportFor(ifcBytes),
      fileSystem: failingFileSystem,
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'BRIDGE_EXPORT_COMMIT_FAILED' } });
    expect(await readdir(outputDirectory)).toEqual([]);
  });

  it('leaves the old complete pair resolvable when the pointer commit fails', async () => {
    const outputDirectory = await temporaryOutput();
    const previousBytes = new TextEncoder().encode('previous committed pair');
    const previousReport = await executedReportFor(previousBytes);
    unwrap(
      await commitValidatedBridgeExport({
        outputDirectory,
        projectKey: 'test-bridge',
        ifcBytes: previousBytes,
        report: previousReport,
        fileSystem: NODE_FILE_SYSTEM,
      })
    );
    const before = unwrap(
      await resolveCommittedBridgeExport(outputDirectory, 'test-bridge', NODE_FILE_SYSTEM)
    );
    const candidateBytes = new TextEncoder().encode('candidate pointer failure');
    const failingFileSystem: BridgeExportFileSystem = {
      ...NODE_FILE_SYSTEM,
      replaceFileAtomically: () => Promise.reject(new Error('injected pointer commit failure')),
    };

    const result = await commitValidatedBridgeExport({
      outputDirectory,
      projectKey: 'test-bridge',
      ifcBytes: candidateBytes,
      report: await executedReportFor(candidateBytes),
      fileSystem: failingFileSystem,
    });

    expect(result).toMatchObject({ ok: false });
    const after = unwrap(
      await resolveCommittedBridgeExport(outputDirectory, 'test-bridge', NODE_FILE_SYSTEM)
    );
    expect(after).toEqual(before);
    expect(new Uint8Array(await readFile(after.ifcPath))).toEqual(previousBytes);
  });

  it('lets an interleaving reader resolve only the complete old or complete new pair', async () => {
    const outputDirectory = await temporaryOutput();
    const previousBytes = new TextEncoder().encode('reader old pair');
    unwrap(
      await commitValidatedBridgeExport({
        outputDirectory,
        projectKey: 'test-bridge',
        ifcBytes: previousBytes,
        report: await executedReportFor(previousBytes),
        fileSystem: NODE_FILE_SYSTEM,
      })
    );
    const observed: string[] = [];
    const candidateBytes = new TextEncoder().encode('reader new pair');
    const observingFileSystem: BridgeExportFileSystem = {
      ...NODE_FILE_SYSTEM,
      replaceFileAtomically: async (from, to) => {
        observed.push(
          unwrap(
            await resolveCommittedBridgeExport(outputDirectory, 'test-bridge', NODE_FILE_SYSTEM)
          ).modelHash
        );
        await NODE_FILE_SYSTEM.replaceFileAtomically(from, to);
        observed.push(
          unwrap(
            await resolveCommittedBridgeExport(outputDirectory, 'test-bridge', NODE_FILE_SYSTEM)
          ).modelHash
        );
      },
    };

    unwrap(
      await commitValidatedBridgeExport({
        outputDirectory,
        projectKey: 'test-bridge',
        ifcBytes: candidateBytes,
        report: await executedReportFor(candidateBytes),
        fileSystem: observingFileSystem,
      })
    );

    expect(observed).toEqual([
      createHash('sha256').update(previousBytes).digest('hex'),
      createHash('sha256').update(candidateBytes).digest('hex'),
    ]);
  });

  it('serializes equivalent-path writers through the filesystem lock', async () => {
    const outputDirectory = await temporaryOutput();
    const firstBytes = new TextEncoder().encode('concurrent first pair');
    const secondBytes = new TextEncoder().encode('concurrent second pair');
    let pointerReached: (() => void) | undefined;
    const firstPointer = new Promise<void>((resolve) => {
      pointerReached = resolve;
    });
    const delayedFileSystem: BridgeExportFileSystem = {
      ...NODE_FILE_SYSTEM,
      replaceFileAtomically: async (from, to) => {
        pointerReached?.();
        await new Promise((resolve) => setTimeout(resolve, 30));
        await NODE_FILE_SYSTEM.replaceFileAtomically(from, to);
      },
    };
    const first = commitValidatedBridgeExport({
      outputDirectory,
      projectKey: 'test-bridge',
      ifcBytes: firstBytes,
      report: await executedReportFor(firstBytes),
      fileSystem: delayedFileSystem,
    });
    await firstPointer;
    const second = commitValidatedBridgeExport({
      outputDirectory: relative(process.cwd(), outputDirectory),
      projectKey: 'test-bridge',
      ifcBytes: secondBytes,
      report: await executedReportFor(secondBytes),
      fileSystem: NODE_FILE_SYSTEM,
    });

    expect(unwrap(await first).committed).toBe(true);
    expect(unwrap(await second).committed).toBe(true);
    const resolved = unwrap(
      await resolveCommittedBridgeExport(outputDirectory, 'test-bridge', NODE_FILE_SYSTEM)
    );
    expect(resolved.modelHash).toBe(createHash('sha256').update(secondBytes).digest('hex'));
  });

  it('refuses an artifact-shaped pointer without deleting its contents', async () => {
    const outputDirectory = await temporaryOutput();
    const pointerDirectory = join(outputDirectory, 'test-bridge.bridge-export.json');
    const sentinelPath = join(pointerDirectory, 'user-data.txt');
    await mkdir(pointerDirectory, { recursive: true });
    await writeFile(sentinelPath, 'must survive');
    const ifcBytes = new TextEncoder().encode('directory collision candidate');

    const result = await commitValidatedBridgeExport({
      outputDirectory,
      projectKey: 'test-bridge',
      ifcBytes,
      report: await executedReportFor(ifcBytes),
      fileSystem: NODE_FILE_SYSTEM,
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'BRIDGE_EXPORT_TARGET_NOT_FILE' },
    });
    expect(await readFile(sentinelPath, 'utf8')).toBe('must survive');
  });

  it('reports a committed pair without rollback when release throws after unlocking', async () => {
    const outputDirectory = await temporaryOutput();
    const firstBytes = new TextEncoder().encode('first committed before release uncertainty');
    const newerBytes = new TextEncoder().encode('newer writer after unlock');
    let nested = false;
    const uncertainFileSystem: BridgeExportFileSystem = {
      ...NODE_FILE_SYSTEM,
      acquireExclusiveLock: async (path) => {
        const lock = await NODE_FILE_SYSTEM.acquireExclusiveLock(path);
        return {
          release: async () => {
            await lock.release();
            if (!nested) {
              nested = true;
              unwrap(
                await commitValidatedBridgeExport({
                  outputDirectory,
                  projectKey: 'test-bridge',
                  ifcBytes: newerBytes,
                  report: await executedReportFor(newerBytes),
                  fileSystem: NODE_FILE_SYSTEM,
                })
              );
            }
            throw new Error('release threw after unlocking');
          },
        };
      },
    };

    const first = unwrap(
      await commitValidatedBridgeExport({
        outputDirectory,
        projectKey: 'test-bridge',
        ifcBytes: firstBytes,
        report: await executedReportFor(firstBytes),
        fileSystem: uncertainFileSystem,
      })
    );

    expect(first).toMatchObject({ committed: true, lockStatus: 'unknown' });
    const resolved = unwrap(
      await resolveCommittedBridgeExport(outputDirectory, 'test-bridge', NODE_FILE_SYSTEM)
    );
    expect(resolved.modelHash).toBe(createHash('sha256').update(newerBytes).digest('hex'));
  });

  it('releases the writer lock when staging creation fails so a retry can proceed', async () => {
    const outputDirectory = await temporaryOutput();
    const ifcBytes = new TextEncoder().encode('staging creation retry candidate');
    let held = false;
    let failStaging = true;
    const stagingFailureFileSystem: BridgeExportFileSystem = {
      ...NODE_FILE_SYSTEM,
      acquireExclusiveLock: () => {
        if (held) throw new Error('lock is still held');
        held = true;
        return Promise.resolve({
          release: () => {
            held = false;
            return Promise.resolve();
          },
        });
      },
      mkdtemp: async (prefix) => {
        if (failStaging) {
          failStaging = false;
          throw new Error('injected staging creation failure');
        }
        return NODE_FILE_SYSTEM.mkdtemp(prefix);
      },
    };

    const first = await commitValidatedBridgeExport({
      outputDirectory,
      projectKey: 'test-bridge',
      ifcBytes,
      report: await executedReportFor(ifcBytes),
      fileSystem: stagingFailureFileSystem,
    });
    expect(first).toMatchObject({ ok: false });
    expect(held).toBe(false);

    const retry = unwrap(
      await commitValidatedBridgeExport({
        outputDirectory,
        projectKey: 'test-bridge',
        ifcBytes,
        report: await executedReportFor(ifcBytes),
        fileSystem: stagingFailureFileSystem,
      })
    );
    expect(retry.committed).toBe(true);
  });

  it('hashes and writes one immutable snapshot of caller-owned IFC bytes', async () => {
    const outputDirectory = await temporaryOutput();
    const ifcBytes = new TextEncoder().encode('immutable candidate snapshot');
    const expectedBytes = Uint8Array.from(ifcBytes);
    const report = await executedReportFor(ifcBytes);
    const mutatingFileSystem: BridgeExportFileSystem = {
      ...NODE_FILE_SYSTEM,
      mkdir: async (path) => {
        ifcBytes.fill(88);
        await NODE_FILE_SYSTEM.mkdir(path);
      },
    };

    const result = unwrap(
      await commitValidatedBridgeExport({
        outputDirectory,
        projectKey: 'test-bridge',
        ifcBytes,
        report,
        fileSystem: mutatingFileSystem,
      })
    );
    if (!result.committed) throw new Error('expected committed export');

    expect(new Uint8Array(await readFile(result.ifcPath))).toEqual(expectedBytes);
  });
});
