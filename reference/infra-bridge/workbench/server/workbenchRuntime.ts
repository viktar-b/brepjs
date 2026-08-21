import { basename } from 'node:path';
import type {
  ComparisonCaseError,
  ComparisonCaseResult,
  ReferenceManifest,
  ReconstructionTarget,
} from '../../src/index.js';
import type {
  AuthoredOccurrenceNode,
  CompareEvaluatedOccurrenceRequest,
  EvaluatedOccurrenceNode,
  ReferenceOccurrenceNode,
} from '../../node/compareEvaluatedOccurrence.js';
import type {
  ComparisonDiagnostic,
  OverallDiagnostic,
  WorkbenchCatalog,
  WorkbenchDiagnosticError,
  WorkbenchProduct,
  WorkbenchResult,
} from '../shared/protocol.js';
import { createLatestSnapshot } from './latestSnapshot.js';

export type BackendResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: WorkbenchDiagnosticError };

export interface ReferenceSnapshot {
  readonly targets: ReadonlyMap<string, ReconstructionTarget>;
  readonly referenceScenes: ReadonlyMap<string, ReferenceOccurrenceNode>;
}

export interface AuthoredSnapshot {
  readonly resolvedNodes: ReadonlyMap<string, AuthoredOccurrenceNode>;
  readonly evaluatedNodes: ReadonlyMap<string, EvaluatedOccurrenceNode>;
}

export interface WorkbenchRuntimeConfig {
  readonly ifcPath: string;
  readonly manifest: ReferenceManifest;
}

export interface WorkbenchRuntimeDependencies {
  readonly loadReference: () => Promise<BackendResult<ReferenceSnapshot>>;
  readonly evaluateAuthored: () => Promise<BackendResult<AuthoredSnapshot>>;
  readonly compare: (request: CompareEvaluatedOccurrenceRequest) => ComparisonCaseResult;
  readonly assembleOverall: (request: {
    readonly semanticKeys: readonly string[];
    readonly targets: ReferenceSnapshot['targets'];
    readonly referenceScenes: ReferenceSnapshot['referenceScenes'];
    readonly resolvedNodes: AuthoredSnapshot['resolvedNodes'];
    readonly evaluatedNodes: AuthoredSnapshot['evaluatedNodes'];
  }) => BackendResult<Omit<OverallDiagnostic, 'revision' | 'durationMs' | 'computedAt'>>;
  readonly now: () => number;
  readonly isoNow: () => string;
}

export interface WorkbenchRuntime {
  catalog(): Promise<WorkbenchResult<WorkbenchCatalog>>;
  overall(): Promise<WorkbenchResult<OverallDiagnostic>>;
  refreshOverall(): Promise<WorkbenchResult<OverallDiagnostic>>;
  comparison(semanticKey: string): Promise<WorkbenchResult<ComparisonDiagnostic>>;
  refresh(semanticKey: string): Promise<WorkbenchResult<ComparisonDiagnostic>>;
  invalidateSource(): number;
}

/** Own the configured Reference, authored snapshot, per-key comparisons, and cache revision. */
export function createWorkbenchRuntime(
  config: WorkbenchRuntimeConfig,
  dependencies: WorkbenchRuntimeDependencies
): WorkbenchRuntime {
  let referencePromise: Promise<BackendResult<ReferenceSnapshot>> | undefined;
  let overallResult: WorkbenchResult<OverallDiagnostic> | undefined;
  let activeOverall:
    | {
        readonly revision: number;
        readonly result: Promise<WorkbenchResult<OverallDiagnostic>>;
      }
    | undefined;
  const comparisons = new Map<string, WorkbenchResult<ComparisonDiagnostic>>();
  const activeComparisons = new Map<
    string,
    {
      readonly revision: number;
      readonly result: Promise<WorkbenchResult<ComparisonDiagnostic>>;
    }
  >();
  const knownKeys = new Set(config.manifest.mappings.map(({ semanticKey }) => semanticKey));
  const authoredSnapshots = createLatestSnapshot(() => dependencies.evaluateAuthored());

  const unknownKeyFailure = <T>(semanticKey: string): WorkbenchResult<T> =>
    failure(authoredSnapshots.revision(), {
      stage: 'configuration',
      code: 'UNKNOWN_SEMANTIC_KEY',
      message: 'The requested Semantic Key is not present in referenceManifest.json',
      context: { semanticKey },
      retryable: false,
      action: 'Choose one of the products listed by the Workbench catalog',
    });

  const getReference = async (): Promise<BackendResult<ReferenceSnapshot>> => {
    const pending = referencePromise ?? dependencies.loadReference();
    referencePromise = pending;
    try {
      const result = await pending;
      if (!result.ok && referencePromise === pending) referencePromise = undefined;
      return result;
    } catch (cause) {
      if (referencePromise === pending) referencePromise = undefined;
      throw cause;
    }
  };

  const catalog = (): Promise<WorkbenchResult<WorkbenchCatalog>> =>
    Promise.resolve({
      ok: true,
      revision: authoredSnapshots.revision(),
      value: {
        title: 'Infra-bridge Reconstruction Workbench',
        products: config.manifest.mappings.map(({ semanticKey }) => product(semanticKey)),
        reference: {
          path: config.ifcPath,
          fileName: basename(config.ifcPath),
          expectedChecksum: config.manifest.checksum,
          productCount: config.manifest.mappings.length,
        },
        sourceRevision: authoredSnapshots.revision(),
      },
    });

  function overall(): Promise<WorkbenchResult<OverallDiagnostic>> {
    const requestedRevision = authoredSnapshots.revision();
    if (overallResult?.revision === requestedRevision) return Promise.resolve(overallResult);
    if (activeOverall?.revision === requestedRevision) return activeOverall.result;

    const computed = computeOverall(requestedRevision);
    const result = computed.finally(() => {
      if (activeOverall?.result === result) activeOverall = undefined;
    });
    activeOverall = { revision: requestedRevision, result };
    return result;
  }

  async function computeOverall(
    requestedRevision: number
  ): Promise<WorkbenchResult<OverallDiagnostic>> {
    const startedAt = dependencies.now();
    const [reference, candidate] = await Promise.all([getReference(), authoredSnapshots.current()]);
    const revision = candidate.revision;
    if (revision !== requestedRevision || revision !== authoredSnapshots.revision()) {
      return overall();
    }
    if (overallResult?.revision === revision) return overallResult;
    if (!reference.ok) return failure(revision, reference.error);
    if (!candidate.ok) return failure(revision, candidate.error);

    const assembled = dependencies.assembleOverall({
      semanticKeys: config.manifest.mappings.map(({ semanticKey }) => semanticKey),
      targets: reference.value.targets,
      referenceScenes: reference.value.referenceScenes,
      resolvedNodes: candidate.value.resolvedNodes,
      evaluatedNodes: candidate.value.evaluatedNodes,
    });
    const result: WorkbenchResult<OverallDiagnostic> = assembled.ok
      ? {
          ok: true,
          revision,
          value: {
            ...assembled.value,
            revision,
            durationMs: Math.max(0, dependencies.now() - startedAt),
            computedAt: dependencies.isoNow(),
          },
        }
      : failure(revision, assembled.error);
    if ((result.ok || !result.error.retryable) && revision === authoredSnapshots.revision()) {
      overallResult = result;
    }
    return revision === authoredSnapshots.revision() ? result : overall();
  }

  function comparison(semanticKey: string): Promise<WorkbenchResult<ComparisonDiagnostic>> {
    const requestedRevision = authoredSnapshots.revision();
    if (!knownKeys.has(semanticKey)) {
      return Promise.resolve(unknownKeyFailure(semanticKey));
    }
    const cached = comparisons.get(semanticKey);
    if (cached !== undefined && cached.revision === requestedRevision) {
      return Promise.resolve(cached);
    }
    const active = activeComparisons.get(semanticKey);
    if (active?.revision === requestedRevision) return active.result;

    const computed = computeComparison(semanticKey, requestedRevision);
    const result = computed.finally(() => {
      if (activeComparisons.get(semanticKey)?.result === result) {
        activeComparisons.delete(semanticKey);
      }
    });
    activeComparisons.set(semanticKey, { revision: requestedRevision, result });
    return result;
  }

  async function computeComparison(
    semanticKey: string,
    requestedRevision: number
  ): Promise<WorkbenchResult<ComparisonDiagnostic>> {
    const startedAt = dependencies.now();
    const [reference, candidate] = await Promise.all([getReference(), authoredSnapshots.current()]);
    const revision = candidate.revision;
    if (revision !== requestedRevision || revision !== authoredSnapshots.revision()) {
      return comparison(semanticKey);
    }
    const completedByPeer = comparisons.get(semanticKey);
    if (completedByPeer !== undefined && completedByPeer.revision === revision) {
      return completedByPeer;
    }
    if (!reference.ok) return failure(revision, reference.error);
    if (!candidate.ok) return failure(revision, candidate.error);

    const compared = dependencies.compare({
      semanticKey,
      targets: reference.value.targets,
      referenceScenes: reference.value.referenceScenes,
      resolvedNodes: candidate.value.resolvedNodes,
      evaluatedNodes: candidate.value.evaluatedNodes,
    });
    const result: WorkbenchResult<ComparisonDiagnostic> = compared.ok
      ? {
          ok: true,
          revision,
          value: {
            ...compared.value,
            revision,
            durationMs: Math.max(0, dependencies.now() - startedAt),
            computedAt: dependencies.isoNow(),
          },
        }
      : failure(revision, diagnosticFromComparisonError(compared.error));
    const cacheable = result.ok || !result.error.retryable;
    if (cacheable && revision === authoredSnapshots.revision()) {
      comparisons.set(semanticKey, result);
    }
    return revision === authoredSnapshots.revision() ? result : comparison(semanticKey);
  }

  const invalidateSource = (): number => {
    overallResult = undefined;
    comparisons.clear();
    return authoredSnapshots.invalidate();
  };

  return {
    catalog,
    overall,
    async refreshOverall() {
      invalidateSource();
      return overall();
    },
    comparison,
    async refresh(semanticKey) {
      if (!knownKeys.has(semanticKey)) return unknownKeyFailure(semanticKey);
      invalidateSource();
      return comparison(semanticKey);
    },
    invalidateSource,
  };
}

function product(semanticKey: string): WorkbenchProduct {
  const segments = semanticKey.split('/');
  const leaf = segments.at(-1) ?? semanticKey;
  const group = semanticKey.includes('/rail-site-01/')
    ? 'Rail bridge 01'
    : semanticKey.includes('/rail-site-02/')
      ? 'Rail bridge 02'
      : 'Road river bridge';
  return {
    semanticKey,
    group,
    label: titleCase(leaf),
    detail: segments.slice(-3).map(titleCase).join(' / '),
  };
}

function titleCase(value: string): string {
  return value.replaceAll('-', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function failure<T>(revision: number, error: WorkbenchDiagnosticError): WorkbenchResult<T> {
  return { ok: false, revision, error };
}

function diagnosticFromComparisonError(error: ComparisonCaseError): WorkbenchDiagnosticError {
  const causeContext =
    error.cause === undefined
      ? {}
      : {
          ...(error.cause.context ?? {}),
          causeCode: error.cause.code,
          causeMessage: error.cause.message,
        };
  const context = {
    ...error.context,
    ...causeContext,
    semanticKey: error.semanticKey,
  };
  const invalidTopology = error.cause?.code === 'INVALID_TOPOLOGY';
  const errorSource = error.context['source'];
  const causeSource = error.cause?.context?.['source'];
  const referenceTopologyFailure = invalidTopology && causeSource === 'reference';
  const referenceFailure =
    referenceTopologyFailure ||
    error.code === 'REFERENCE_TARGET_MISSING' ||
    error.code === 'REFERENCE_SCENE_NODE_MISSING' ||
    error.code === 'REFERENCE_SCENE_KEY_MISMATCH' ||
    ((error.code === 'SEMANTIC_KEY_MISMATCH' || error.code === 'INVALID_FRAME') &&
      errorSource === 'reference');
  if (referenceFailure) {
    return {
      stage: 'reference-decode',
      code: error.code,
      message: error.message,
      context,
      retryable: false,
      action: `${error.suggestion}. Restart the workbench after correcting the Reference`,
    };
  }
  const topologyFailure =
    (invalidTopology && causeSource === 'candidate') ||
    error.code === 'INVALID_CANDIDATE_MESH' ||
    error.code === 'INVALID_FRAME';
  if (topologyFailure) {
    return {
      stage: 'topology',
      code: error.code,
      message: error.message,
      context,
      retryable: true,
      action: error.suggestion,
    };
  }
  const authoredFailure =
    error.stage === 'evaluation' ||
    error.code === 'CANDIDATE_OCCURRENCE_MISSING' ||
    error.code === 'CANDIDATE_MESH_MISSING' ||
    (error.code === 'SEMANTIC_KEY_MISMATCH' && errorSource === 'candidate');
  return {
    stage: authoredFailure ? 'authored-evaluation' : 'scoring',
    code: error.code,
    message: error.message,
    context,
    retryable: true,
    action: error.suggestion,
  };
}
