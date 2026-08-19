export type LengthUnit = 'millimetre';
export type ObservationVector = readonly [number, number, number];
export type Triangle = readonly [number, number, number];

export interface ObservedFrame {
  readonly origin: ObservationVector;
  readonly xAxis: ObservationVector;
  readonly zAxis: ObservationVector;
}

/** A representation-independent comparison surface in one declared unit. */
export interface SurfaceObservation {
  readonly unit: LengthUnit;
  readonly vertices: readonly ObservationVector[];
  readonly triangles: readonly Triangle[];
  readonly closed: boolean;
}

export interface DimensionObservation {
  readonly name: string;
  readonly value: number;
  readonly unit: LengthUnit;
}

export interface PlaneObservation {
  readonly kind: 'plane';
  /** One exact point on the plane in component-local millimetres. */
  readonly point: ObservationVector;
  readonly normal: ObservationVector;
}

export interface CylinderObservation {
  readonly kind: 'cylinder';
  readonly origin: ObservationVector;
  readonly axis: ObservationVector;
  readonly radius: number;
}

export type AnalyticSurfaceObservation = PlaneObservation | CylinderObservation;

export interface LineObservation {
  readonly kind: 'line';
  /** Exact line anchor and the retained topological trim. */
  readonly point: ObservationVector;
  readonly direction: ObservationVector;
  readonly start: ObservationVector;
  readonly end: ObservationVector;
}

export interface CircleObservation {
  readonly kind: 'circle';
  readonly center: ObservationVector;
  readonly normal: ObservationVector;
  readonly radius: number;
}

export type AnalyticCurveObservation = LineObservation | CircleObservation;

export interface TopologyEdgeObservation {
  readonly vertices: readonly [number, number];
}

export interface TopologyFaceObservation {
  /** Oriented boundary vertex and edge indices into this observation. */
  readonly vertices: readonly number[];
  readonly edges: readonly number[];
}

export interface TopologyObservation {
  readonly vertexCount: number;
  readonly edgeCount: number;
  readonly faceCount: number;
  readonly closed: boolean;
  readonly vertices?: readonly ObservationVector[] | undefined;
  readonly edges?: readonly TopologyEdgeObservation[] | undefined;
  readonly faces?: readonly TopologyFaceObservation[] | undefined;
}

/** Optional analytic and topological facts retained beside the comparison surface. */
export interface AnalyticEvidence {
  readonly surfaces: readonly AnalyticSurfaceObservation[];
  readonly curves: readonly AnalyticCurveObservation[];
  readonly topology: TopologyObservation;
}

/** Source-neutral target used to compare one authored semantic occurrence. */
export interface ReconstructionTarget {
  readonly semanticKey: string;
  readonly comparisonSurface: SurfaceObservation;
  readonly dimensions?: readonly DimensionObservation[] | undefined;
  readonly analyticEvidence?: AnalyticEvidence | undefined;
}

interface ReferenceNodeBase {
  readonly referenceKey: string;
  readonly name?: string | undefined;
  /** Placement relative to the returned parent; for a returned root, this equals worldFrame. */
  readonly localFrame: ObservedFrame;
  /** Composed scene placement, kept separate from component-local target geometry. */
  readonly worldFrame: ObservedFrame;
}

export interface ReferenceSpatialNode extends ReferenceNodeBase {
  readonly kind: 'spatial';
  readonly children: readonly ReferenceSceneNode[];
}

export interface ReferenceProductNode extends ReferenceNodeBase {
  readonly kind: 'product';
  readonly material?: string | undefined;
  readonly targetKey?: string | undefined;
}

export type ReferenceSceneNode = ReferenceSpatialNode | ReferenceProductNode;

/** Source-neutral hierarchy, placement, and target mapping for reference evidence. */
export interface ReferenceScene {
  readonly unit: LengthUnit;
  readonly roots: readonly ReferenceSceneNode[];
}

/** Evidence that selected occurrences reuse one source representation, without source identity. */
export interface ReferenceRepetitionObservation {
  readonly semanticKeys: readonly string[];
  readonly evidence: 'shared-representation';
}
