export type WorkbenchPreset = 'reference' | 'candidate' | 'overlay';
export type WorkbenchLayer = 'reference' | 'candidate';
export type LayerControl = 'visible' | 'xray' | 'edges';
export type SectionAxis = 'x' | 'y' | 'z';
export type CameraPreset = 'iso' | 'front' | 'top' | 'right';
export type ProjectionMode = 'perspective' | 'orthographic';

export interface LayerControls {
  readonly visible: boolean;
  readonly xray: boolean;
  readonly edges: boolean;
}

export interface SectionControls {
  readonly enabled: boolean;
  readonly axis: SectionAxis;
  readonly positionMm: number;
  readonly minimumMm: number;
  readonly maximumMm: number;
  readonly flipped: boolean;
}

export interface CameraControls {
  readonly preset: CameraPreset;
  readonly presetRequest: number;
  readonly projection: ProjectionMode;
  readonly gridVisible: boolean;
  readonly fitRequest: number;
}

export interface WorkbenchUiState {
  readonly selectedSemanticKey: string | null;
  readonly activePreset: WorkbenchPreset;
  readonly presetIsCustomized: boolean;
  readonly layers: Readonly<Record<WorkbenchLayer, LayerControls>>;
  readonly section: SectionControls;
  readonly camera: CameraControls;
}

export type WorkbenchUiAction =
  | { readonly type: 'select'; readonly semanticKey: string | null }
  | { readonly type: 'apply-preset'; readonly preset: WorkbenchPreset }
  | {
      readonly type: 'set-layer';
      readonly layer: WorkbenchLayer;
      readonly control: LayerControl;
      readonly value: boolean;
    }
  | { readonly type: 'set-section-enabled'; readonly enabled: boolean }
  | { readonly type: 'set-section-axis'; readonly axis: SectionAxis }
  | { readonly type: 'set-section-position'; readonly positionMm: number }
  | {
      readonly type: 'set-section-range';
      readonly minimumMm: number;
      readonly maximumMm: number;
    }
  | { readonly type: 'set-section-flipped'; readonly flipped: boolean }
  | { readonly type: 'set-camera-preset'; readonly preset: CameraPreset }
  | { readonly type: 'set-projection'; readonly projection: ProjectionMode }
  | { readonly type: 'set-grid'; readonly visible: boolean }
  | { readonly type: 'request-fit' };

export const VIEW_PRESET_LAYERS: Readonly<
  Record<WorkbenchPreset, Readonly<Record<WorkbenchLayer, LayerControls>>>
> = {
  reference: {
    reference: { visible: true, xray: false, edges: true },
    candidate: { visible: false, xray: false, edges: true },
  },
  candidate: {
    reference: { visible: false, xray: false, edges: true },
    candidate: { visible: true, xray: false, edges: true },
  },
  overlay: {
    reference: { visible: true, xray: true, edges: false },
    candidate: { visible: true, xray: false, edges: true },
  },
};

export function createInitialWorkbenchUiState(
  selectedSemanticKey: string | null = null
): WorkbenchUiState {
  return {
    selectedSemanticKey,
    activePreset: 'overlay',
    presetIsCustomized: false,
    layers: VIEW_PRESET_LAYERS.overlay,
    section: {
      enabled: false,
      axis: 'x',
      positionMm: 0,
      minimumMm: -1_000,
      maximumMm: 1_000,
      flipped: false,
    },
    camera: {
      preset: 'iso',
      presetRequest: 0,
      projection: 'perspective',
      gridVisible: true,
      fitRequest: 0,
    },
  };
}

export function workbenchUiReducer(
  state: WorkbenchUiState,
  action: WorkbenchUiAction
): WorkbenchUiState {
  switch (action.type) {
    case 'select':
      if (action.semanticKey === state.selectedSemanticKey) return state;
      return {
        ...state,
        selectedSemanticKey: action.semanticKey,
        camera: { ...state.camera, fitRequest: state.camera.fitRequest + 1 },
      };
    case 'apply-preset':
      return {
        ...state,
        activePreset: action.preset,
        presetIsCustomized: false,
        layers: VIEW_PRESET_LAYERS[action.preset],
        camera: { ...state.camera, fitRequest: state.camera.fitRequest + 1 },
      };
    case 'set-layer':
      return {
        ...state,
        presetIsCustomized: true,
        layers: {
          ...state.layers,
          [action.layer]: {
            ...state.layers[action.layer],
            [action.control]: action.value,
          },
        },
      };
    case 'set-section-enabled':
      return { ...state, section: { ...state.section, enabled: action.enabled } };
    case 'set-section-axis':
      return { ...state, section: { ...state.section, axis: action.axis } };
    case 'set-section-position':
      return {
        ...state,
        section: {
          ...state.section,
          positionMm: clampFinite(
            action.positionMm,
            state.section.minimumMm,
            state.section.maximumMm,
            state.section.positionMm
          ),
        },
      };
    case 'set-section-range': {
      const range = normalizeRange(action.minimumMm, action.maximumMm, state.section);
      return {
        ...state,
        section: {
          ...state.section,
          ...range,
          positionMm: clampFinite(
            state.section.positionMm,
            range.minimumMm,
            range.maximumMm,
            range.minimumMm
          ),
        },
      };
    }
    case 'set-section-flipped':
      return { ...state, section: { ...state.section, flipped: action.flipped } };
    case 'set-camera-preset':
      return {
        ...state,
        camera: {
          ...state.camera,
          preset: action.preset,
          presetRequest: state.camera.presetRequest + 1,
        },
      };
    case 'set-projection':
      return { ...state, camera: { ...state.camera, projection: action.projection } };
    case 'set-grid':
      return { ...state, camera: { ...state.camera, gridVisible: action.visible } };
    case 'request-fit':
      return {
        ...state,
        camera: { ...state.camera, fitRequest: state.camera.fitRequest + 1 },
      };
  }
}

function normalizeRange(
  first: number,
  second: number,
  fallback: SectionControls
): Pick<SectionControls, 'minimumMm' | 'maximumMm'> {
  if (!Number.isFinite(first) || !Number.isFinite(second)) {
    return { minimumMm: fallback.minimumMm, maximumMm: fallback.maximumMm };
  }
  return first <= second
    ? { minimumMm: first, maximumMm: second }
    : { minimumMm: second, maximumMm: first };
}

function clampFinite(value: number, minimum: number, maximum: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, value));
}
