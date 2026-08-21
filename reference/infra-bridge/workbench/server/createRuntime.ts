import { readFile } from 'node:fs/promises';
import type { ReferenceManifest } from '../../src/index.js';
import { compareEvaluatedOccurrence } from '../../node/compareEvaluatedOccurrence.js';
import { loadReferenceSnapshot } from './referenceLoader.js';
import { assembleOverallDiagnostic } from './overallDiagnostic.js';
import {
  createWorkbenchRuntime,
  type AuthoredSnapshot,
  type BackendResult,
  type WorkbenchRuntime,
} from './workbenchRuntime.js';

export interface ConfiguredRuntimeOptions {
  readonly ifcPath: string;
  readonly evaluateAuthored: () => Promise<BackendResult<AuthoredSnapshot>>;
}

/** Create the infra-bridge runtime around the tracked manifest and configured Reference path. */
export async function createConfiguredRuntime(
  options: ConfiguredRuntimeOptions
): Promise<WorkbenchRuntime> {
  const manifest = JSON.parse(
    await readFile(new URL('../../referenceManifest.json', import.meta.url), 'utf8')
  ) as ReferenceManifest;
  return createWorkbenchRuntime(
    { ifcPath: options.ifcPath, manifest },
    {
      loadReference: () => loadReferenceSnapshot({ ifcPath: options.ifcPath, manifest }),
      evaluateAuthored: options.evaluateAuthored,
      compare: compareEvaluatedOccurrence,
      assembleOverall: assembleOverallDiagnostic,
      now: () => performance.now(),
      isoNow: () => new Date().toISOString(),
    }
  );
}
