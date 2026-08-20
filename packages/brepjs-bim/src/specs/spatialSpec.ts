export interface ProjectSpec {
  readonly name: string;
  readonly description?: string;
  /**
   * Optional stable, globally-unique project identifier used to scope all derived
   * GlobalIds. Supply a UUID (or any stable unique string) when the model will be
   * federated/diffed/exported to COBie/BCF so its GlobalIds are unique across
   * models. When omitted, the scope falls back to the project name+description
   * (stable, but unique only per distinct name).
   */
  readonly projectId?: string;
  /**
   * Optional geodetic coordinate reference system. When present the writer
   * emits IfcProjectedCRS + IfcMapConversion against the model context, which
   * establishes proper georeferencing (buildingSMART rule GRF003 asks for a
   * CRS whenever facilities such as buildings are modelled).
   */
  readonly crs?: ProjectCrs | ProjectCrsMm;
}

export interface ProjectCrs {
  /** CRS name, conventionally an EPSG code (e.g. "EPSG:25832"). */
  readonly name: string;
  readonly description?: string | undefined;
  readonly geodeticDatum?: string | undefined;
  readonly verticalDatum?: string | undefined;
  readonly mapProjection?: string | undefined;
  readonly mapZone?: string | undefined;
  /** Map coordinates of the model origin, in metres. Default 0. */
  readonly eastings?: number | undefined;
  readonly northings?: number | undefined;
  readonly orthogonalHeight?: number | undefined;
  /** Rotation of the model X axis in the map plane (abscissa/ordinate pair). */
  readonly xAxisAbscissa?: number | undefined;
  readonly xAxisOrdinate?: number | undefined;
  readonly scale?: number | undefined;
  readonly eastingMm?: never;
  readonly northingMm?: never;
  readonly elevationMm?: never;
  readonly xAxisBearingDeg?: never;
}

/**
 * Millimetre-first projected CRS configuration for civil authoring. The map
 * origin positions the project engineering frame in the named projected CRS;
 * it is not added to any Site, Facility, Spatial Part, or product Local Frame.
 * `xAxisBearingDeg` is the project +X bearing clockwise from projected grid
 * north. Projection derives IFC axis ratios and fixes map-conversion scale at 1.
 */
export interface ProjectCrsMm {
  /** CRS name, conventionally an EPSG code (e.g. "EPSG:25832"). */
  readonly name: string;
  readonly description?: string | undefined;
  readonly geodeticDatum?: string | undefined;
  /** Explicit height datum used by the three-dimensional projected context. */
  readonly verticalDatum: string;
  readonly mapProjection?: string | undefined;
  readonly mapZone?: string | undefined;
  readonly eastingMm: number;
  readonly northingMm: number;
  readonly elevationMm: number;
  readonly xAxisBearingDeg: number;
  readonly eastings?: never;
  readonly northings?: never;
  readonly orthogonalHeight?: never;
  readonly xAxisAbscissa?: never;
  readonly xAxisOrdinate?: never;
  readonly scale?: never;
}

export const IFC_ELEMENT_COMPOSITION_TYPES = ['COMPLEX', 'ELEMENT', 'PARTIAL'] as const;
export type IfcElementCompositionType = (typeof IFC_ELEMENT_COMPOSITION_TYPES)[number];

export interface SiteSpec {
  readonly name: string;
  readonly description?: string;
  /**
   * Optional parent-relative Local Frame, authored in millimetres. A root Site
   * is relative to the project frame; a nested Site is relative to its parent
   * Site. Existing building callers default to the identity frame.
   */
  readonly origin?: [number, number, number] | undefined;
  readonly axisX?: [number, number, number] | undefined;
  readonly axisZ?: [number, number, number] | undefined;
  /** IFC Projection value mapped from authored Spatial Composition. */
  readonly compositionType?: IfcElementCompositionType | undefined;
}

export interface BuildingSpec {
  readonly name: string;
  readonly description?: string;
}

export interface StoreySpec {
  readonly name: string;
  readonly elevation: number; // mm above site datum
}
