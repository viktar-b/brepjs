import { Grid } from '@react-three/drei';
import {
  EdgeRenderer,
  Renderer,
  ViewerCanvas,
  meshBounds,
  sectionPlane,
  type MeshData,
} from 'brepjs-viewer';
import { useMemo, useRef, type Dispatch } from 'react';
import type {
  ComparisonDiagnostic,
  DiagnosticSurface,
  WorkbenchDiagnosticError,
} from '../shared/protocol.js';
import { mergeMeshData, surfaceToMeshData } from './mesh.js';
import type { WorkbenchTheme } from './theme.js';
import type {
  CameraPreset,
  SectionAxis,
  WorkbenchLayer,
  WorkbenchPreset,
  WorkbenchUiAction,
  WorkbenchUiState,
} from './uiState.js';

export interface WorkbenchViewportProps {
  readonly diagnostic: ViewportDiagnostic | undefined;
  readonly error: WorkbenchDiagnosticError | undefined;
  readonly busy: boolean;
  readonly theme: WorkbenchTheme;
  readonly ui: WorkbenchUiState;
  readonly dispatch: Dispatch<WorkbenchUiAction>;
  readonly onRetry: (() => void) | undefined;
  readonly variant?: 'comparison' | 'candidate' | undefined;
}

export type ViewportDiagnostic = Pick<ComparisonDiagnostic, 'semanticKey' | 'surfaces'>;

const REFERENCE_COLOR = '#61d7f4';
const CANDIDATE_COLOR = '#f0ad55';
const PRESETS: readonly WorkbenchPreset[] = ['reference', 'candidate', 'overlay'];
const CAMERAS: readonly CameraPreset[] = ['iso', 'front', 'top', 'right'];
const AXES: readonly SectionAxis[] = ['x', 'y', 'z'];

export function WorkbenchViewport({
  diagnostic,
  error,
  busy,
  theme,
  ui,
  dispatch,
  onRetry,
  variant = 'comparison',
}: WorkbenchViewportProps) {
  const candidateOnly = variant === 'candidate';
  return (
    <section
      className={`viewport-pane${candidateOnly ? ' viewport-pane--candidate' : ''}`}
      aria-label={candidateOnly ? 'Evaluated Candidate geometry' : 'Canonical comparison viewport'}
    >
      <div className="viewport-stage">
        {diagnostic === undefined && error !== undefined ? (
          <ViewportFailure error={error} onRetry={onRetry} />
        ) : diagnostic === undefined ? (
          <ViewportLoading />
        ) : (
          <DiagnosticCanvas
            diagnostic={diagnostic}
            theme={theme}
            ui={ui}
            candidateOnly={candidateOnly}
          />
        )}
        {busy && diagnostic !== undefined && (
          <div className="recompute-scrim" role="status" aria-live="polite">
            <span className="mini-spinner" aria-hidden="true" />
            Evaluating authored Model · previous view held
          </div>
        )}
      </div>
      <ViewportControls ui={ui} dispatch={dispatch} candidateOnly={candidateOnly} />
    </section>
  );
}

function ViewportControls({
  ui,
  dispatch,
  candidateOnly,
}: {
  ui: WorkbenchUiState;
  dispatch: Dispatch<WorkbenchUiAction>;
  candidateOnly: boolean;
}) {
  return (
    <details className="viewport-controls" open>
      <summary>
        <span>View controls</span>
        <span>{ui.presetIsCustomized ? 'Custom view' : ui.activePreset}</span>
      </summary>
      <div className="viewport-controls__body">
        {!candidateOnly && (
          <div className="mode-switcher" role="group" aria-label="Comparison mode">
            {PRESETS.map((preset) => (
              <ControlButton
                key={preset}
                label={titleCase(preset)}
                active={ui.activePreset === preset && !ui.presetIsCustomized}
                onClick={() => {
                  dispatch({ type: 'apply-preset', preset });
                }}
              />
            ))}
          </div>
        )}

        <div className="layer-controls" aria-label="Layer controls">
          {!candidateOnly && <LayerRow layer="reference" ui={ui} dispatch={dispatch} />}
          <LayerRow layer="candidate" ui={ui} dispatch={dispatch} />
        </div>

        <div className="camera-controls" role="group" aria-label="Camera controls">
          {CAMERAS.map((preset) => (
            <ControlButton
              key={preset}
              label={titleCase(preset)}
              active={ui.camera.preset === preset}
              onClick={() => {
                dispatch({ type: 'set-camera-preset', preset });
              }}
            />
          ))}
          <span className="control-divider" aria-hidden="true" />
          <ControlButton
            label="Orthographic"
            shortLabel="Ortho"
            active={ui.camera.projection === 'orthographic'}
            onClick={() => {
              dispatch({
                type: 'set-projection',
                projection:
                  ui.camera.projection === 'orthographic' ? 'perspective' : 'orthographic',
              });
            }}
          />
          <ControlButton
            label={candidateOnly ? 'Fit source geometry' : 'Fit'}
            shortLabel="Fit"
            onClick={() => {
              dispatch({ type: 'request-fit' });
            }}
          />
          <ControlButton
            label="Grid"
            active={ui.camera.gridVisible}
            onClick={() => {
              dispatch({ type: 'set-grid', visible: !ui.camera.gridVisible });
            }}
          />
        </div>

        <div className="section-controls" aria-label="Section plane controls">
          <ControlButton
            label="Section plane"
            shortLabel="Section"
            active={ui.section.enabled}
            onClick={() => {
              dispatch({ type: 'set-section-enabled', enabled: !ui.section.enabled });
            }}
          />
          {ui.section.enabled && (
            <>
              <div className="axis-switcher" role="group" aria-label="Section axis">
                {AXES.map((axis) => (
                  <ControlButton
                    key={axis}
                    label={`CAD ${axis.toUpperCase()}`}
                    shortLabel={axis.toUpperCase()}
                    active={ui.section.axis === axis}
                    onClick={() => {
                      dispatch({ type: 'set-section-axis', axis });
                    }}
                  />
                ))}
              </div>
              <label className="section-slider">
                <span className="sr-only">Section position</span>
                <input
                  type="range"
                  aria-label="Section position"
                  min={ui.section.minimumMm}
                  max={ui.section.maximumMm}
                  step={sectionStep(ui.section.minimumMm, ui.section.maximumMm)}
                  value={ui.section.positionMm}
                  onChange={(event) => {
                    dispatch({
                      type: 'set-section-position',
                      positionMm: Number(event.target.value),
                    });
                  }}
                />
                <output>{formatMillimetres(ui.section.positionMm)}</output>
              </label>
              <ControlButton
                label="Flip section"
                shortLabel="Flip"
                active={ui.section.flipped}
                onClick={() => {
                  dispatch({ type: 'set-section-flipped', flipped: !ui.section.flipped });
                }}
              />
            </>
          )}
        </div>
      </div>
    </details>
  );
}

function DiagnosticCanvas({
  diagnostic,
  theme,
  ui,
  candidateOnly,
}: {
  diagnostic: ViewportDiagnostic;
  theme: WorkbenchTheme;
  ui: WorkbenchUiState;
  candidateOnly: boolean;
}) {
  const referenceCache = useRef(new Map<string, MeshData>());
  const referenceData = useMemo(() => {
    const cacheKey = `${diagnostic.semanticKey}|${theme}`;
    const cached = referenceCache.current.get(cacheKey);
    if (cached !== undefined) return cached;
    const hydrated = surfaceToMeshData(
      diagnostic.surfaces.reference,
      theme === 'light' ? '#1687a3' : REFERENCE_COLOR
    );
    referenceCache.current.set(cacheKey, hydrated);
    return hydrated;
  }, [diagnostic.semanticKey, diagnostic.surfaces.reference, theme]);
  const candidateData = useMemo(
    () =>
      surfaceToMeshData(
        diagnostic.surfaces.candidate,
        theme === 'light' ? '#c16b1b' : CANDIDATE_COLOR
      ),
    [diagnostic.surfaces.candidate, theme]
  );
  const framingCache = useRef<
    | {
        readonly semanticKey: string;
        readonly fitRequest: number;
        readonly visibilityKey: string;
        readonly data: MeshData;
      }
    | undefined
  >(undefined);
  const framingData = useMemo(() => {
    const cached = framingCache.current;
    const visibilityKey = `${!candidateOnly && ui.layers.reference.visible ? 'reference' : ''}|${
      ui.layers.candidate.visible ? 'candidate' : ''
    }`;
    if (
      cached !== undefined &&
      cached.semanticKey === diagnostic.semanticKey &&
      cached.fitRequest === ui.camera.fitRequest &&
      cached.visibilityKey === visibilityKey
    ) {
      return cached.data;
    }
    const visible = [
      ...(!candidateOnly && ui.layers.reference.visible ? [referenceData] : []),
      ...(ui.layers.candidate.visible ? [candidateData] : []),
    ];
    const data = mergeMeshData(visible.length > 0 ? visible : [referenceData, candidateData]);
    framingCache.current = {
      semanticKey: diagnostic.semanticKey,
      fitRequest: ui.camera.fitRequest,
      visibilityKey,
      data,
    };
    return data;
  }, [
    candidateData,
    diagnostic.semanticKey,
    referenceData,
    ui.camera.fitRequest,
    ui.layers.candidate.visible,
    ui.layers.reference.visible,
    candidateOnly,
  ]);
  const clippingPlanes = useMemo(() => {
    if (!ui.section.enabled) return undefined;
    const mapped = viewerSection(ui.section.axis, ui.section.positionMm, ui.section.flipped);
    return [sectionPlane(mapped.axis, mapped.position, mapped.flip)];
  }, [ui.section.axis, ui.section.enabled, ui.section.flipped, ui.section.positionMm]);
  const clippingProps = clippingPlanes === undefined ? {} : { clippingPlanes };
  const grid = useMemo(
    () => scaleAwareGrid(referenceData, candidateData),
    [referenceData, candidateData]
  );
  const fitSignal = ui.camera.fitRequest * 10_000 + ui.camera.presetRequest;

  return (
    <>
      <div className="viewport-badges">
        <span className="coordinate-badge">Canonical component-local</span>
        <span className="units-badge">mm · CAD Z-up</span>
      </div>
      <ViewerCanvas
        data={framingData}
        colorScheme={theme}
        view={ui.camera.preset}
        fitSignal={fitSignal}
        projection={ui.camera.projection}
        gridVisible={false}
        errorFallback={(error, reset) => (
          <div className="canvas-error" role="alert">
            <strong>3D view could not render</strong>
            <span>{error.message}</span>
            <button type="button" onClick={reset}>
              Reset view
            </button>
          </div>
        )}
      >
        {ui.camera.gridVisible && (
          <Grid
            args={[grid.extent, grid.extent]}
            position={[grid.centerX, grid.floorY, grid.centerZ]}
            cellSize={grid.cellSize}
            sectionSize={grid.sectionSize}
            cellThickness={0.45}
            sectionThickness={0.9}
            cellColor={theme === 'light' ? '#aebdc3' : '#26303a'}
            sectionColor={theme === 'light' ? '#7f939b' : '#41505f'}
            fadeDistance={grid.fadeDistance}
            fadeStrength={1.4}
            infiniteGrid
          />
        )}
        {!candidateOnly && ui.layers.reference.visible && (
          <Renderer
            data={referenceData}
            viewMode={ui.layers.reference.xray ? 'xray' : 'solid'}
            {...clippingProps}
          />
        )}
        {!candidateOnly && ui.layers.reference.visible && ui.layers.reference.edges && (
          <EdgeRenderer edges={referenceData.edges} {...clippingProps} />
        )}
        {ui.layers.candidate.visible && (
          <Renderer
            data={candidateData}
            viewMode={ui.layers.candidate.xray ? 'xray' : 'solid'}
            {...clippingProps}
          />
        )}
        {ui.layers.candidate.visible && ui.layers.candidate.edges && (
          <EdgeRenderer edges={candidateData.edges} {...clippingProps} />
        )}
      </ViewerCanvas>
    </>
  );
}

function LayerRow({
  layer,
  ui,
  dispatch,
}: {
  layer: WorkbenchLayer;
  ui: WorkbenchUiState;
  dispatch: Dispatch<WorkbenchUiAction>;
}) {
  const controls = ui.layers[layer];
  const name = titleCase(layer);
  return (
    <div className={`layer-row layer-row--${layer}`}>
      <span className="layer-label">
        <i aria-hidden="true" />
        {name}
      </span>
      {(['visible', 'xray', 'edges'] as const).map((control) => (
        <ControlButton
          key={control}
          label={`${name} ${control === 'xray' ? 'x-ray' : control}`}
          shortLabel={control === 'visible' ? 'Eye' : titleCase(control)}
          active={controls[control]}
          onClick={() => {
            dispatch({ type: 'set-layer', layer, control, value: !controls[control] });
          }}
        />
      ))}
    </div>
  );
}

function ControlButton({
  label,
  shortLabel,
  active,
  onClick,
}: {
  label: string;
  shortLabel?: string | undefined;
  active?: boolean | undefined;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="control-button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
    >
      {shortLabel ?? label}
    </button>
  );
}

function ViewportFailure({
  error,
  onRetry,
}: {
  error: WorkbenchDiagnosticError;
  onRetry: (() => void) | undefined;
}) {
  return (
    <div className="viewport-failure">
      <span className="viewport-failure__mark" aria-hidden="true">
        !
      </span>
      <span className="panel-kicker">{titleCase(error.stage.replaceAll('-', ' '))}</span>
      <strong>{error.message}</strong>
      <p>{error.action}</p>
      <code>{error.code}</code>
      {onRetry !== undefined && (
        <button type="button" onClick={onRetry}>
          Retry comparison
        </button>
      )}
    </div>
  );
}

function ViewportLoading() {
  return (
    <div className="viewport-loading" role="status" aria-live="polite">
      <div className="loading-reticle" aria-hidden="true">
        <i />
        <i />
        <span />
      </div>
      <strong>Preparing comparison surface</strong>
      <span>Reference → authored Model → canonical normalization → scoring</span>
    </div>
  );
}

function viewerSection(axis: SectionAxis, position: number, flip: boolean) {
  if (axis === 'x') return { axis: 'x' as const, position, flip };
  if (axis === 'z') return { axis: 'y' as const, position, flip };
  return { axis: 'z' as const, position: -position, flip: !flip };
}

function scaleAwareGrid(reference: MeshData, candidate: MeshData) {
  const referenceBounds = meshBounds(reference);
  const candidateBounds = meshBounds(candidate);
  const min = referenceBounds.min.map((value, index) =>
    Math.min(value, candidateBounds.min[index] ?? value)
  ) as [number, number, number];
  const max = referenceBounds.max.map((value, index) =>
    Math.max(value, candidateBounds.max[index] ?? value)
  ) as [number, number, number];
  const horizontalExtent = Math.max(max[0] - min[0], max[2] - min[2], 1);
  const cellSize = niceStep(horizontalExtent / 12);
  return {
    centerX: (min[0] + max[0]) / 2,
    centerZ: (min[2] + max[2]) / 2,
    floorY: min[1] - Math.max(horizontalExtent * 0.005, 0.1),
    extent: horizontalExtent * 5,
    cellSize,
    sectionSize: cellSize * 5,
    fadeDistance: horizontalExtent * 2.5,
  };
}

function niceStep(value: number): number {
  const power = 10 ** Math.floor(Math.log10(Math.max(value, Number.EPSILON)));
  const normalized = value / power;
  const multiplier = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return multiplier * power;
}

export function surfaceRange(surface: DiagnosticSurface, axis: SectionAxis): [number, number] {
  const coordinate = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  if (surface.vertices.length === 0) return [0, 0];
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (const vertex of surface.vertices) {
    const value = vertex[coordinate];
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  return [minimum, maximum];
}

function sectionStep(minimum: number, maximum: number): number {
  return Math.max((maximum - minimum) / 240, 0.01);
}

function formatMillimetres(value: number): string {
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value)} mm`;
}

function titleCase(value: string): string {
  return value.charAt(0).toLocaleUpperCase() + value.slice(1);
}
