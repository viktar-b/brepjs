import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  SOURCE_INVALIDATED_EVENT,
  type SourceInvalidatedPayload,
  type ComparisonDiagnostic,
  type WorkbenchCatalog,
  type WorkbenchDiagnosticError,
} from '../shared/protocol.js';
import { EvidenceLedger } from './EvidenceLedger.js';
import { ProductRail } from './ProductRail.js';
import { WorkbenchViewport, surfaceRange } from './WorkbenchViewport.js';
import { createInitialWorkbenchUiState, workbenchUiReducer, type SectionAxis } from './uiState.js';
import { createWorkbenchClient } from './workbenchClient.js';

type RequestPhase = 'catalog' | 'comparison' | 'recompute' | 'ready' | 'error';
type ReferenceVerification = 'pending' | 'verified' | 'failed';

interface SourceInvalidationChannel {
  on(
    event: typeof SOURCE_INVALIDATED_EVENT,
    callback: (payload: SourceInvalidatedPayload) => void
  ): void;
  off?(
    event: typeof SOURCE_INVALIDATED_EVENT,
    callback: (payload: SourceInvalidatedPayload) => void
  ): void;
}

export function App() {
  const client = useMemo(() => createWorkbenchClient(), []);
  const [catalog, setCatalog] = useState<WorkbenchCatalog>();
  const [catalogError, setCatalogError] = useState<WorkbenchDiagnosticError>();
  const [diagnostic, setDiagnostic] = useState<ComparisonDiagnostic>();
  const [comparisonError, setComparisonError] = useState<WorkbenchDiagnosticError>();
  const [comparisonRevision, setComparisonRevision] = useState<number>();
  const [phase, setPhase] = useState<RequestPhase>('catalog');
  const [query, setQuery] = useState('');
  const [watcherState, setWatcherState] = useState<'watching' | 'changed'>('watching');
  const [ui, dispatch] = useReducer(workbenchUiReducer, null, () =>
    createInitialWorkbenchUiState()
  );
  const diagnosticRef = useRef<ComparisonDiagnostic | undefined>(undefined);
  diagnosticRef.current = diagnostic;
  const selectedKeyRef = useRef<string | null>(ui.selectedSemanticKey);
  selectedKeyRef.current = ui.selectedSemanticKey;

  const loadCatalog = useCallback(async () => {
    setPhase('catalog');
    setCatalogError(undefined);
    const result = await client.loadCatalog();
    if (result === undefined) return;
    if (!result.ok) {
      setCatalogError(result.error);
      setPhase('error');
      return;
    }
    setCatalog(result.value);
    const firstKey = result.value.products[0]?.semanticKey ?? null;
    dispatch({ type: 'select', semanticKey: firstKey });
  }, [client]);

  const requestComparison = useCallback(
    async (semanticKey: string, kind: 'load' | 'refresh' | 'source-change') => {
      const keepPrevious = diagnosticRef.current?.semanticKey === semanticKey;
      setPhase(kind === 'load' && !keepPrevious ? 'comparison' : 'recompute');
      setComparisonError(undefined);
      if (!keepPrevious) setDiagnostic(undefined);

      const result =
        kind === 'refresh'
          ? await client.refreshComparison(semanticKey)
          : await client.loadComparison(semanticKey);
      if (result === undefined || selectedKeyRef.current !== semanticKey) return;
      setComparisonRevision(result.revision);
      if (!result.ok) {
        setComparisonError(result.error);
        setPhase('error');
        return;
      }
      setDiagnostic(result.value);
      setComparisonError(undefined);
      setPhase('ready');
      setWatcherState('watching');
    },
    [client]
  );

  useEffect(() => {
    void loadCatalog();
    return () => {
      client.cancelActive();
    };
  }, [client, loadCatalog]);

  useEffect(() => {
    const semanticKey = ui.selectedSemanticKey;
    if (catalog === undefined || semanticKey === null) return;
    void requestComparison(semanticKey, 'load');
  }, [catalog, requestComparison, ui.selectedSemanticKey]);

  useEffect(() => {
    const active = diagnostic;
    if (active === undefined || active.semanticKey !== ui.selectedSemanticKey) return;
    const [minimumMm, maximumMm] = combinedSurfaceRange(active, ui.section.axis);
    dispatch({ type: 'set-section-range', minimumMm, maximumMm });
  }, [diagnostic, ui.section.axis, ui.selectedSemanticKey]);

  useEffect(() => {
    const hot = import.meta.hot as SourceInvalidationChannel | undefined;
    if (hot === undefined) return;
    const handleInvalidation = (payload: SourceInvalidatedPayload) => {
      if (payload.revision < client.getRequestState().acceptedRevision) return;
      const semanticKey = selectedKeyRef.current;
      if (semanticKey === null) return;
      setWatcherState('changed');
      void requestComparison(semanticKey, 'source-change');
    };
    hot.on(SOURCE_INVALIDATED_EVENT, handleInvalidation);
    return () => {
      hot.off?.(SOURCE_INVALIDATED_EVENT, handleInvalidation);
    };
  }, [requestComparison]);

  const handleSelect = (semanticKey: string) => {
    if (semanticKey !== ui.selectedSemanticKey) {
      setComparisonError(undefined);
      setDiagnostic(undefined);
      setComparisonRevision(undefined);
    }
    dispatch({ type: 'select', semanticKey });
  };

  if (catalog === undefined) {
    return (
      <main className="workbench-shell workbench-shell--initial">
        <CommandBar
          catalog={undefined}
          phase={phase}
          referenceVerification={referenceVerification(undefined, catalogError)}
          watcherState={watcherState}
          onRecompute={undefined}
        />
        {catalogError === undefined ? (
          <InitialLoading />
        ) : (
          <div className="initial-error">
            <DiagnosticError error={catalogError} onRetry={() => void loadCatalog()} />
          </div>
        )}
      </main>
    );
  }

  const selectedKey = ui.selectedSemanticKey ?? catalog.products[0]?.semanticKey ?? '';
  const selectedDiagnostic = diagnostic?.semanticKey === selectedKey ? diagnostic : undefined;
  const busy = phase === 'comparison' || phase === 'recompute';
  const previous =
    selectedDiagnostic !== undefined && (phase === 'recompute' || comparisonError !== undefined);
  const footerRevision =
    comparisonRevision ?? selectedDiagnostic?.revision ?? catalog.sourceRevision;
  const retrySelected =
    comparisonError?.retryable === true
      ? () => void requestComparison(selectedKey, 'refresh')
      : undefined;

  return (
    <main className="workbench-shell">
      <CommandBar
        catalog={catalog}
        phase={phase}
        referenceVerification={referenceVerification(selectedDiagnostic, comparisonError)}
        watcherState={watcherState}
        onRecompute={
          selectedKey.length === 0 || busy
            ? undefined
            : () => void requestComparison(selectedKey, 'refresh')
        }
      />

      <div className="survey-workspace">
        <ProductRail
          products={catalog.products}
          selectedKey={selectedKey}
          query={query}
          onQueryChange={setQuery}
          onSelect={handleSelect}
        />

        <WorkbenchViewport
          diagnostic={selectedDiagnostic}
          error={comparisonError}
          busy={busy}
          ui={ui}
          dispatch={dispatch}
          onRetry={retrySelected}
        />

        <div className="evidence-column">
          {comparisonError !== undefined && (
            <DiagnosticError
              error={comparisonError}
              compact={selectedDiagnostic !== undefined}
              onRetry={retrySelected}
            />
          )}
          {selectedDiagnostic === undefined ? (
            comparisonError === undefined && <EvidenceLoading />
          ) : (
            <EvidenceLedger diagnostic={selectedDiagnostic} previous={previous} />
          )}
        </div>
      </div>

      <footer
        className="status-footer"
        aria-live={comparisonError === undefined ? 'polite' : 'off'}
      >
        <StatusSummary phase={phase} diagnostic={selectedDiagnostic} error={comparisonError} />
        <div className="footer-ledger">
          <span>Revision {footerRevision}</span>
          <span>
            {selectedDiagnostic === undefined
              ? 'Awaiting score'
              : `${selectedDiagnostic.durationMs.toLocaleString('en-US')} ms`}
          </span>
          <span title={catalog.reference.expectedChecksum}>
            SHA {catalog.reference.expectedChecksum.slice(0, 10)}…
          </span>
          <span>
            {selectedDiagnostic === undefined
              ? 'No completed run'
              : formatRunTime(selectedDiagnostic.computedAt)}
          </span>
        </div>
      </footer>
    </main>
  );
}

function CommandBar({
  catalog,
  phase,
  referenceVerification,
  watcherState,
  onRecompute,
}: {
  catalog: WorkbenchCatalog | undefined;
  phase: RequestPhase;
  referenceVerification: ReferenceVerification;
  watcherState: 'watching' | 'changed';
  onRecompute: (() => void) | undefined;
}) {
  return (
    <header className="command-bar">
      <div className="brand-block">
        <span className="brand-mark" aria-hidden="true">
          B
        </span>
        <div>
          <span className="eyebrow">brepjs · Reference Harness</span>
          <h1>Reconstruction Workbench</h1>
        </div>
      </div>
      <div className="command-status">
        <span
          className={`reference-status reference-status--${referenceVerification}`}
          title={catalog?.reference.path}
        >
          <i aria-hidden="true" />
          {catalog === undefined ? 'Reference' : catalog.reference.fileName}
          <small>
            {referenceVerification === 'verified'
              ? 'checksum verified'
              : referenceVerification === 'failed'
                ? 'verification failed'
                : catalog === undefined
                  ? 'connecting'
                  : 'verification pending'}
          </small>
        </span>
        <span className={`watcher-status watcher-status--${watcherState}`}>
          <i aria-hidden="true" />
          {watcherState === 'watching' ? 'Watching TSX' : 'Source change detected'}
        </span>
        <button
          type="button"
          className="primary-action"
          disabled={onRecompute === undefined}
          onClick={onRecompute}
          aria-busy={phase === 'recompute'}
        >
          <RefreshIcon spinning={phase === 'recompute'} />
          Recompute
        </button>
      </div>
    </header>
  );
}

function DiagnosticError({
  error,
  compact = false,
  onRetry,
}: {
  error: WorkbenchDiagnosticError;
  compact?: boolean;
  onRetry?: (() => void) | undefined;
}) {
  return (
    <section
      className={`diagnostic-error${compact ? ' diagnostic-error--compact' : ''}`}
      role="alert"
    >
      <div className="error-heading">
        <span className="error-icon" aria-hidden="true">
          !
        </span>
        <div>
          <span>{stageLabel(error.stage)}</span>
          <code>{error.code}</code>
        </div>
      </div>
      <strong>{error.message}</strong>
      <p>{error.action}</p>
      {Object.keys(error.context).length > 0 && (
        <dl className="error-context">
          {Object.entries(error.context).map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{String(value)}</dd>
            </div>
          ))}
        </dl>
      )}
      {onRetry !== undefined && (
        <button type="button" className="secondary-action" onClick={onRetry}>
          <RefreshIcon spinning={false} />
          Retry
        </button>
      )}
    </section>
  );
}

function InitialLoading() {
  return (
    <section className="initial-loading" aria-live="polite">
      <div className="initial-loading__graphic" aria-hidden="true">
        <span />
        <span />
        <i />
      </div>
      <span className="panel-kicker">Reference setup</span>
      <h2>Opening the survey bench</h2>
      <p>Reading the manifest and connecting to the local diagnostic runtime.</p>
      <div className="loading-sequence" aria-label="Loading catalog">
        <span className="active">01 · Catalog</span>
        <span>02 · Reference</span>
        <span>03 · Authored Model</span>
        <span>04 · Score</span>
      </div>
    </section>
  );
}

function EvidenceLoading() {
  return (
    <section className="evidence-loading" aria-live="polite">
      <div className="section-heading">
        <span>—</span>
        <h2>Fidelity evidence</h2>
      </div>
      <p>Metrics will appear after the selected Occurrence is evaluated and scored.</p>
      {Array.from({ length: 8 }, (_, index) => (
        <span
          className="skeleton-line"
          key={index}
          style={{ width: `${(92 - (index % 3) * 9).toString()}%` }}
        />
      ))}
    </section>
  );
}

function StatusSummary({
  phase,
  diagnostic,
  error,
}: {
  phase: RequestPhase;
  diagnostic: ComparisonDiagnostic | undefined;
  error: WorkbenchDiagnosticError | undefined;
}) {
  if (error !== undefined) {
    return (
      <span className="footer-state footer-state--error">
        <i aria-hidden="true" /> {stageLabel(error.stage)} · {error.code}
      </span>
    );
  }
  if (phase === 'comparison' || phase === 'recompute') {
    return (
      <span className="footer-state footer-state--busy">
        <i aria-hidden="true" />{' '}
        {phase === 'recompute'
          ? 'Recomputing selected comparison'
          : 'Evaluating selected Occurrence'}
      </span>
    );
  }
  return (
    <span className={`footer-state footer-state--${diagnostic?.pass === false ? 'fail' : 'ready'}`}>
      <i aria-hidden="true" />
      {diagnostic === undefined
        ? 'Workbench ready'
        : diagnostic.pass
          ? 'Fidelity Gate evidence passes'
          : 'Fidelity Gate attention required'}
    </span>
  );
}

function combinedSurfaceRange(
  diagnostic: ComparisonDiagnostic,
  axis: SectionAxis
): [number, number] {
  const reference = surfaceRange(diagnostic.surfaces.reference, axis);
  const candidate = surfaceRange(diagnostic.surfaces.candidate, axis);
  return [Math.min(reference[0], candidate[0]), Math.max(reference[1], candidate[1])];
}

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg className={spinning ? 'is-spinning' : undefined} viewBox="0 0 20 20" aria-hidden="true">
      <path d="M15.9 7.2A6.2 6.2 0 1 0 16 12" />
      <path d="M16 3.5v4h-4" />
    </svg>
  );
}

function stageLabel(stage: WorkbenchDiagnosticError['stage']): string {
  return {
    configuration: 'Configuration',
    'reference-file': 'Reference file',
    checksum: 'Checksum',
    'reference-decode': 'Reference decode',
    'authored-evaluation': 'Authored evaluation',
    topology: 'Topology',
    scoring: 'Scoring',
  }[stage];
}

function referenceVerification(
  diagnostic: ComparisonDiagnostic | undefined,
  error: WorkbenchDiagnosticError | undefined
): ReferenceVerification {
  if (
    error?.stage === 'reference-file' ||
    error?.stage === 'checksum' ||
    error?.stage === 'reference-decode'
  ) {
    return 'failed';
  }
  if (
    diagnostic !== undefined ||
    error?.stage === 'authored-evaluation' ||
    error?.stage === 'topology' ||
    error?.stage === 'scoring'
  ) {
    return 'verified';
  }
  return 'pending';
}

function formatRunTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Completed';
  return `Updated ${new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date)}`;
}

declare global {
  // React uses this marker to suppress false-positive act warnings in direct DOM tests.
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
