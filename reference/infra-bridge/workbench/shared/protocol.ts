export type DiagnosticVector = readonly [number, number, number];
export type DiagnosticTriangle = readonly [number, number, number];

export interface DiagnosticFrame {
  readonly origin: DiagnosticVector;
  readonly xAxis: DiagnosticVector;
  readonly zAxis: DiagnosticVector;
}

export interface DiagnosticSurface {
  readonly unit: 'millimetre';
  readonly vertices: readonly DiagnosticVector[];
  readonly triangles: readonly DiagnosticTriangle[];
  readonly closed: boolean;
}

export interface DiagnosticScore {
  readonly surfaceDistance: {
    readonly maximumMm: number;
    readonly meanMm: number;
    readonly p95Mm: number;
    readonly areaSampleCount: number;
  };
  readonly normalAgreement: {
    readonly meanCosine: number;
    readonly minimumCosine: number;
  };
  readonly envelope: {
    readonly deltasMm: {
      readonly xMin: number;
      readonly xMax: number;
      readonly yMin: number;
      readonly yMax: number;
      readonly zMin: number;
      readonly zMax: number;
    };
    readonly maximumAbsoluteDeltaMm: number;
  };
  readonly volume?:
    | {
        readonly targetMm3: number;
        readonly candidateMm3: number;
        readonly relativeError: number;
      }
    | undefined;
  readonly closedSolidIoU?:
    { readonly value: number; readonly method: 'exact-envelope' | 'voxel-32' } | undefined;
}

export type DiagnosticGateId =
  | 'frame-control-point'
  | 'frame-x-axis'
  | 'frame-z-axis'
  | 'envelope-maximum'
  | 'surface-p95'
  | 'surface-maximum'
  | 'normal-mean'
  | 'volume-relative-error';

export interface DiagnosticGate {
  readonly id: DiagnosticGateId;
  readonly value: number | null;
  readonly threshold: number;
  readonly relation: 'at-most' | 'at-least';
  readonly unit: 'millimetre' | 'degree' | 'ratio';
  readonly status: 'pass' | 'fail' | 'not-applicable' | 'unavailable';
}

export interface ComparisonDiagnostic {
  readonly semanticKey: string;
  readonly revision: number;
  readonly durationMs: number;
  readonly computedAt: string;
  readonly coordinateSpace: 'canonical-component-local';
  readonly surfaces: {
    readonly reference: DiagnosticSurface;
    readonly candidate: DiagnosticSurface;
  };
  readonly frames: {
    readonly referenceLocal: DiagnosticFrame;
    readonly referenceWorld: DiagnosticFrame;
    readonly canonicalWorld: DiagnosticFrame;
    readonly candidateLocal: DiagnosticFrame;
    readonly candidateWorld: DiagnosticFrame;
  };
  readonly frameDeltas: {
    readonly controlPointDeltaMm: number;
    readonly xAxisDeltaDegrees: number;
    readonly zAxisDeltaDegrees: number;
  };
  readonly score: DiagnosticScore;
  readonly gates: readonly DiagnosticGate[];
  readonly pass: boolean;
}

export interface OverallDiagnostic {
  readonly revision: number;
  readonly durationMs: number;
  readonly computedAt: string;
  readonly coordinateSpace: 'world';
  readonly productCount: number;
  readonly surfaces: {
    readonly reference: DiagnosticSurface;
    readonly candidate: DiagnosticSurface;
  };
}

export interface WorkbenchProduct {
  readonly semanticKey: string;
  readonly group: string;
  readonly label: string;
  readonly detail: string;
}

export interface WorkbenchCatalog {
  readonly title: 'Infra-bridge Reconstruction Workbench';
  readonly products: readonly WorkbenchProduct[];
  readonly reference: {
    readonly path: string;
    readonly fileName: string;
    readonly expectedChecksum: string;
    readonly productCount: number;
  };
  readonly sourceRevision: number;
}

export type WorkbenchErrorStage =
  | 'configuration'
  | 'reference-file'
  | 'checksum'
  | 'reference-decode'
  | 'authored-evaluation'
  | 'topology'
  | 'scoring';

export type DiagnosticContextValue = string | number | boolean | null;

export interface WorkbenchDiagnosticError {
  readonly stage: WorkbenchErrorStage;
  readonly code: string;
  readonly message: string;
  readonly context: Readonly<Record<string, DiagnosticContextValue>>;
  readonly retryable: boolean;
  readonly action: string;
}

export type WorkbenchResult<T> =
  | { readonly ok: true; readonly revision: number; readonly value: T }
  | {
      readonly ok: false;
      readonly revision: number;
      readonly error: WorkbenchDiagnosticError;
    };

export const WORKBENCH_API = {
  catalog: '/api/workbench',
  overall: '/api/workbench/overall',
  overallRefresh: '/api/workbench/overall/refresh',
  comparison: '/api/workbench/comparison',
  refresh: '/api/workbench/refresh',
} as const;

export const SOURCE_INVALIDATED_EVENT = 'infra-workbench:source-invalidated';

export interface SourceInvalidatedPayload {
  readonly revision: number;
}
