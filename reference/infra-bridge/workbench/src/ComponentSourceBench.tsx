import { useEffect, useMemo, useRef, useState, type Dispatch } from 'react';
import type {
  ComponentSourceDiagnostic,
  WorkbenchDiagnosticError,
  WorkbenchProduct,
} from '../shared/protocol.js';
import { ProductRail } from './ProductRail.js';
import type { WorkbenchTheme } from './theme.js';
import type { WorkbenchUiAction, WorkbenchUiState } from './uiState.js';
import { WorkbenchViewport, surfaceRange } from './WorkbenchViewport.js';

export interface ComponentSourceBenchProps {
  readonly products: readonly WorkbenchProduct[];
  readonly selectedKey: string;
  readonly query: string;
  readonly diagnostic: ComponentSourceDiagnostic | undefined;
  readonly error: WorkbenchDiagnosticError | undefined;
  readonly busy: boolean;
  readonly previous: boolean;
  readonly theme: WorkbenchTheme;
  readonly ui: WorkbenchUiState;
  readonly dispatch: Dispatch<WorkbenchUiAction>;
  readonly sourceScrollTop: number;
  readonly onSourceScroll: (scrollTop: number) => void;
  readonly onQueryChange: (query: string) => void;
  readonly onSelect: (semanticKey: string) => void;
  readonly onRetry: (() => void) | undefined;
}

/** Read-only Family source and its evaluated Candidate for one selected Occurrence. */
export function ComponentSourceBench({
  products,
  selectedKey,
  query,
  diagnostic,
  error,
  busy,
  previous,
  theme,
  ui,
  dispatch,
  sourceScrollTop,
  onSourceScroll,
  onQueryChange,
  onSelect,
  onRetry,
}: ComponentSourceBenchProps) {
  const selected = products.find(({ semanticKey }) => semanticKey === selectedKey);

  useEffect(() => {
    if (diagnostic === undefined || diagnostic.semanticKey !== selectedKey) return;
    const [minimumMm, maximumMm] = surfaceRange(diagnostic.candidate, ui.section.axis);
    dispatch({ type: 'set-section-range', minimumMm, maximumMm });
  }, [diagnostic, dispatch, selectedKey, ui.section.axis]);

  const viewportDiagnostic = useMemo(
    () =>
      diagnostic === undefined
        ? undefined
        : {
            semanticKey: diagnostic.semanticKey,
            surfaces: { reference: diagnostic.candidate, candidate: diagnostic.candidate },
          },
    [diagnostic]
  );

  return (
    <div className="component-source-workspace">
      <ProductRail
        products={products}
        selectedKey={selectedKey}
        query={query}
        onQueryChange={onQueryChange}
        onSelect={onSelect}
      />

      <section className="component-source-main" aria-label="Component source inspection">
        <header className="component-source-context">
          <div>
            <span className="panel-kicker">Component source</span>
            <strong>{selected?.label ?? selectedKey}</strong>
            <small>{diagnostic?.definitionName ?? 'Family'} · Candidate occurrence</small>
          </div>
          <code title={selectedKey}>{selectedKey}</code>
          <span className="read-only-badge">READ ONLY · edit in IDE</span>
        </header>

        {error !== undefined && (
          <ComponentSourceError
            error={error}
            compact={diagnostic !== undefined}
            onRetry={onRetry}
          />
        )}

        {previous && (
          <div className="component-source-previous" role="status">
            <span aria-hidden="true" /> Previous successful source and geometry held
          </div>
        )}

        <div className="component-source-split">
          <SourcePane
            diagnostic={diagnostic}
            busy={busy}
            scrollTop={sourceScrollTop}
            onScroll={onSourceScroll}
          />
          <WorkbenchViewport
            diagnostic={viewportDiagnostic}
            error={diagnostic === undefined ? error : undefined}
            busy={busy}
            theme={theme}
            ui={ui}
            dispatch={dispatch}
            onRetry={onRetry}
            variant="candidate"
          />
        </div>
      </section>
    </div>
  );
}

function SourcePane({
  diagnostic,
  busy,
  scrollTop,
  onScroll,
}: {
  diagnostic: ComponentSourceDiagnostic | undefined;
  busy: boolean;
  scrollTop: number;
  onScroll: (scrollTop: number) => void;
}) {
  const [copiedSemanticKey, setCopiedSemanticKey] = useState<string>();
  const copyTimer = useRef<number | undefined>(undefined);
  const copyAttempt = useRef(0);
  const currentSemanticKey = useRef(diagnostic?.semanticKey);
  currentSemanticKey.current = diagnostic?.semanticKey;
  const scroll = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = scroll.current;
    if (element !== null) element.scrollTop = scrollTop;
  }, [diagnostic?.semanticKey, scrollTop]);

  useEffect(
    () => () => {
      copyAttempt.current += 1;
      if (copyTimer.current !== undefined) window.clearTimeout(copyTimer.current);
    },
    []
  );

  useEffect(() => {
    copyAttempt.current += 1;
    setCopiedSemanticKey(undefined);
    if (copyTimer.current !== undefined) {
      window.clearTimeout(copyTimer.current);
      copyTimer.current = undefined;
    }
  }, [diagnostic?.semanticKey]);

  const copySource = async () => {
    if (diagnostic === undefined) return;
    const semanticKey = diagnostic.semanticKey;
    const attempt = copyAttempt.current + 1;
    copyAttempt.current = attempt;
    try {
      await navigator.clipboard.writeText(diagnostic.source.text);
      if (copyAttempt.current !== attempt || currentSemanticKey.current !== semanticKey) return;
      setCopiedSemanticKey(semanticKey);
      if (copyTimer.current !== undefined) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => {
        setCopiedSemanticKey(undefined);
        copyTimer.current = undefined;
      }, 1_500);
    } catch {
      if (copyAttempt.current === attempt) setCopiedSemanticKey(undefined);
    }
  };

  const copied = diagnostic !== undefined && copiedSemanticKey === diagnostic.semanticKey;

  return (
    <section className="component-source-pane" aria-label="Family TSX source">
      <header className="component-source-pane__header">
        <div>
          <span className="panel-kicker">Family source</span>
          <strong>{diagnostic?.source.fileName ?? 'Loading source…'}</strong>
        </div>
        {diagnostic !== undefined && (
          <div className="source-file-actions">
            <code title={diagnostic.source.path}>{diagnostic.source.path}</code>
            <button
              type="button"
              className="source-copy-action"
              title={copied ? 'Copied' : 'Copy TSX source'}
              aria-label="Copy Family source"
              onClick={() => void copySource()}
            >
              <span aria-hidden="true">{copied ? '✓' : '⧉'}</span>
              {copied ? 'Copied' : 'Copy source'}
            </button>
          </div>
        )}
      </header>
      <div className="source-tab-strip" aria-hidden="true">
        <span>Family source</span>
        <small>TSX · server highlighted</small>
      </div>
      {diagnostic === undefined ? (
        <div className="component-source-loading" role="status" aria-live="polite">
          <span className="mini-spinner" aria-hidden="true" />
          <strong>Loading approved Family source</strong>
          <small>Mapping selected Occurrence → Family definition → TSX</small>
        </div>
      ) : (
        <div
          ref={scroll}
          className="component-source-code"
          tabIndex={0}
          aria-label={`${diagnostic.source.fileName} read-only source`}
          onScroll={(event) => {
            onScroll(event.currentTarget.scrollTop);
          }}
          dangerouslySetInnerHTML={{ __html: diagnostic.source.highlightedHtml }}
        />
      )}
      {busy && diagnostic !== undefined && (
        <div className="source-refresh-status" role="status">
          <span className="mini-spinner" aria-hidden="true" /> Refreshing source at newest revision
        </div>
      )}
    </section>
  );
}

function ComponentSourceError({
  error,
  compact,
  onRetry,
}: {
  error: WorkbenchDiagnosticError;
  compact: boolean;
  onRetry: (() => void) | undefined;
}) {
  return (
    <section
      className={`component-source-error${compact ? ' component-source-error--compact' : ''}`}
      role="alert"
    >
      <div>
        <span>{error.stage.replaceAll('-', ' ')}</span>
        <code>{error.code}</code>
      </div>
      <strong>{error.message}</strong>
      <p>{error.action}</p>
      {Object.keys(error.context).length > 0 && (
        <dl>
          {Object.entries(error.context).map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{String(value)}</dd>
            </div>
          ))}
        </dl>
      )}
      {onRetry !== undefined && (
        <button type="button" onClick={onRetry}>
          Retry source and geometry
        </button>
      )}
    </section>
  );
}
