import { Grid } from '@react-three/drei';
import {
  EdgeRenderer,
  Renderer,
  ViewerCanvas,
  meshBounds,
  type MeshData,
  type Projection,
  type ViewName,
} from 'brepjs-viewer';
import { useMemo, useRef, useState } from 'react';
import type { OverallDiagnostic, WorkbenchDiagnosticError } from '../shared/protocol.js';
import { surfaceToMeshData } from './mesh.js';
import type { WorkbenchTheme } from './theme.js';

export interface OverallComparisonProps {
  readonly diagnostic: OverallDiagnostic | undefined;
  readonly error: WorkbenchDiagnosticError | undefined;
  readonly busy: boolean;
  readonly theme: WorkbenchTheme;
  readonly onRetry: (() => void) | undefined;
}

const CAMERA_VIEWS: readonly ViewName[] = ['iso', 'front', 'top', 'right'];

/** Render the complete Reference and Candidate Models in paired side-by-side bays. */
export function OverallComparison({
  diagnostic,
  error,
  busy,
  theme,
  onRetry,
}: OverallComparisonProps) {
  const [view, setView] = useState<ViewName>('iso');
  const [projection, setProjection] = useState<Projection>('perspective');
  const [gridVisible, setGridVisible] = useState(true);
  const [fitSignal, setFitSignal] = useState(0);

  return (
    <section className="overall-workspace" aria-label="Overall model comparison">
      <header className="overall-toolbar">
        <div className="overall-toolbar__title">
          <span className="panel-kicker">Primary mode</span>
          <strong>Complete models</strong>
          <small>{diagnostic?.productCount ?? '—'} products per side</small>
        </div>
        <div className="overall-camera-controls" aria-label="Overall camera controls">
          {CAMERA_VIEWS.map((cameraView) => (
            <button
              key={cameraView}
              type="button"
              aria-label={titleCase(cameraView)}
              aria-pressed={view === cameraView}
              onClick={() => {
                setView(cameraView);
              }}
            >
              {titleCase(cameraView)}
            </button>
          ))}
          <i aria-hidden="true" />
          <button
            type="button"
            aria-label="Orthographic"
            aria-pressed={projection === 'orthographic'}
            onClick={() => {
              setProjection((current) =>
                current === 'orthographic' ? 'perspective' : 'orthographic'
              );
            }}
          >
            Ortho
          </button>
          <button
            type="button"
            aria-label="Fit overall models"
            onClick={() => {
              setFitSignal((current) => current + 1);
            }}
          >
            Fit
          </button>
          <button
            type="button"
            aria-label="Overall grid"
            aria-pressed={gridVisible}
            onClick={() => {
              setGridVisible((current) => !current);
            }}
          >
            Grid
          </button>
        </div>
      </header>

      <div className="overall-stage">
        {diagnostic === undefined && error !== undefined ? (
          <OverallFailure error={error} onRetry={onRetry} />
        ) : diagnostic === undefined ? (
          <OverallLoading />
        ) : (
          <OverallCanvas
            diagnostic={diagnostic}
            fitSignal={fitSignal}
            gridVisible={gridVisible}
            projection={projection}
            theme={theme}
            view={view}
          />
        )}
        {busy && diagnostic !== undefined && (
          <div className="recompute-scrim" role="status" aria-live="polite">
            <span className="mini-spinner" aria-hidden="true" />
            Rebuilding both complete models · previous view held
          </div>
        )}
        {error !== undefined && diagnostic !== undefined && (
          <OverallErrorBanner error={error} onRetry={onRetry} />
        )}
      </div>
    </section>
  );
}

function OverallCanvas({
  diagnostic,
  fitSignal,
  gridVisible,
  projection,
  theme,
  view,
}: {
  readonly diagnostic: OverallDiagnostic;
  readonly fitSignal: number;
  readonly gridVisible: boolean;
  readonly projection: Projection;
  readonly theme: WorkbenchTheme;
  readonly view: ViewName;
}) {
  const meshes = useMemo(
    () => ({
      reference: surfaceToMeshData(
        diagnostic.surfaces.reference,
        theme === 'light' ? '#1687a3' : '#61d7f4'
      ),
      candidate: surfaceToMeshData(
        diagnostic.surfaces.candidate,
        theme === 'light' ? '#c16b1b' : '#f0ad55'
      ),
    }),
    [diagnostic.surfaces.candidate, diagnostic.surfaces.reference, theme]
  );

  return (
    <>
      <div className="overall-split">
        <ModelBay
          kind="reference"
          label="Reference model"
          detail="checksummed IFC4X3"
          mesh={meshes.reference}
          fitSignal={fitSignal}
          gridVisible={gridVisible}
          projection={projection}
          theme={theme}
          view={view}
        />
        <ModelBay
          kind="candidate"
          label="Candidate model"
          detail="authored TSX"
          mesh={meshes.candidate}
          fitSignal={fitSignal}
          gridVisible={gridVisible}
          projection={projection}
          theme={theme}
          view={view}
        />
      </div>
      <div className="viewport-badges overall-badges">
        <span className="coordinate-badge">World-space model overview</span>
        <span className="units-badge">mm · paired views</span>
      </div>
    </>
  );
}

function ModelBay({
  detail,
  fitSignal,
  gridVisible,
  kind,
  label,
  mesh,
  projection,
  theme,
  view,
}: {
  readonly detail: string;
  readonly fitSignal: number;
  readonly gridVisible: boolean;
  readonly kind: 'reference' | 'candidate';
  readonly label: string;
  readonly mesh: MeshData;
  readonly projection: Projection;
  readonly theme: WorkbenchTheme;
  readonly view: ViewName;
}) {
  const framingCache = useRef<{ readonly fitSignal: number; readonly data: MeshData } | undefined>(
    undefined
  );
  const framing = useMemo(() => {
    const cached = framingCache.current;
    if (cached?.fitSignal === fitSignal) return cached.data;
    framingCache.current = { fitSignal, data: mesh };
    return mesh;
  }, [fitSignal, mesh]);
  const grid = useMemo(() => gridFor(framing), [framing]);

  return (
    <section className={`overall-model-bay overall-model-bay--${kind}`} aria-label={label}>
      <div className={`overall-model-label overall-model-label--${kind}`}>
        <i aria-hidden="true" />
        <span>{label}</span>
        <small>{detail}</small>
      </div>
      <ViewerCanvas
        data={framing}
        colorScheme={theme}
        view={view}
        fitSignal={fitSignal}
        projection={projection}
        gridVisible={false}
      >
        {gridVisible && (
          <Grid
            args={[grid.extent, grid.extent]}
            position={[grid.centerX, grid.floorY, grid.centerZ]}
            cellSize={grid.cellSize}
            sectionSize={grid.cellSize * 5}
            cellThickness={0.45}
            sectionThickness={0.9}
            cellColor={theme === 'light' ? '#aebdc3' : '#26303a'}
            sectionColor={theme === 'light' ? '#7f939b' : '#41505f'}
            fadeDistance={grid.fadeDistance}
            fadeStrength={1.4}
            infiniteGrid
          />
        )}
        <Renderer data={mesh} />
        <EdgeRenderer edges={mesh.edges} />
      </ViewerCanvas>
    </section>
  );
}

function gridFor(data: MeshData) {
  const bounds = meshBounds(data);
  const extent = Math.max(bounds.max[0] - bounds.min[0], bounds.max[2] - bounds.min[2], 1);
  const cellSize = niceStep(extent / 14);
  return {
    centerX: (bounds.min[0] + bounds.max[0]) / 2,
    centerZ: (bounds.min[2] + bounds.max[2]) / 2,
    floorY: bounds.min[1] - Math.max(extent * 0.005, 0.1),
    extent: extent * 5,
    cellSize,
    fadeDistance: extent * 2.5,
  };
}

function niceStep(value: number): number {
  const power = 10 ** Math.floor(Math.log10(Math.max(value, Number.EPSILON)));
  const normalized = value / power;
  return (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * power;
}

function OverallLoading() {
  return (
    <div className="viewport-loading" role="status" aria-live="polite">
      <div className="loading-reticle" aria-hidden="true">
        <i />
        <i />
        <span />
      </div>
      <strong>Assembling complete models</strong>
      <span>Reference placements → authored Model → shared world overview</span>
    </div>
  );
}

function OverallFailure({
  error,
  onRetry,
}: {
  readonly error: WorkbenchDiagnosticError;
  readonly onRetry: (() => void) | undefined;
}) {
  return (
    <div className="viewport-failure" role="alert">
      <span className="viewport-failure__mark" aria-hidden="true">
        !
      </span>
      <span className="overall-error-stage">{errorStageLabel(error.stage)}</span>
      <strong>{error.message}</strong>
      <code>{error.code}</code>
      <p>{error.action}</p>
      <OverallErrorContext context={error.context} />
      {onRetry !== undefined && (
        <button type="button" onClick={onRetry}>
          Retry overall model
        </button>
      )}
    </div>
  );
}

function OverallErrorBanner({
  error,
  onRetry,
}: {
  readonly error: WorkbenchDiagnosticError;
  readonly onRetry: (() => void) | undefined;
}) {
  return (
    <div className="overall-error-banner" role="alert">
      <span aria-hidden="true">!</span>
      <div>
        <div className="overall-error-banner__heading">
          <span className="overall-error-stage">{errorStageLabel(error.stage)}</span>
          <code>{error.code}</code>
        </div>
        <strong>Latest recompute failed</strong>
        <p>{error.message}</p>
        <small>{error.action}</small>
        <OverallErrorContext context={error.context} />
      </div>
      {onRetry !== undefined && (
        <button type="button" onClick={onRetry}>
          Retry overall model
        </button>
      )}
    </div>
  );
}

function OverallErrorContext({
  context,
}: {
  readonly context: WorkbenchDiagnosticError['context'];
}) {
  const entries = Object.entries(context);
  return entries.length === 0 ? null : (
    <dl className="overall-error-context">
      {entries.map(([key, value]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>{String(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function errorStageLabel(stage: WorkbenchDiagnosticError['stage']): string {
  return {
    configuration: 'Configuration',
    'reference-file': 'Reference file',
    checksum: 'Checksum',
    'reference-decode': 'Reference decode',
    'authored-evaluation': 'Authored evaluation',
    'source-file': 'Source file',
    topology: 'Topology',
    scoring: 'Scoring',
  }[stage];
}

function titleCase(value: string): string {
  const first = value[0];
  return first === undefined ? value : `${first.toUpperCase()}${value.slice(1)}`;
}
