/** Human-authored civil control points and bearings, in millimetres and degrees. */
export const ROAD_SITE_SET_OUT = {
  origin: [17_320.508, 30_000, 0] as const,
  bearingDegrees: 120,
} as const;

export const ROAD_BRIDGE_SET_OUT = {
  datum: {
    origin: [0, 0, 242.321] as const,
    bearingFromSiteDegrees: -90,
  },
  approaches: {
    start: { origin: [-4_945.5, -1_684, 0] as const, bearingDegrees: 90 },
    end: { origin: [4_945.5, -1_684, 0] as const, bearingDegrees: 90 },
    slab: { xOffset: -116, runFromDeckEnd: 2_443.111, elevation: -242.321 },
    abutment: { xOffset: -116, runFromDeckEnd: 175, elevation: -756 },
  },
  piers: {
    start: { origin: [-4_795.5, 0, 0] as const, bearingDegrees: 90 },
    centre: { origin: [0, 0, 0] as const, bearingDegrees: -90 },
    end: { origin: [4_845.5, 0, 0] as const, bearingDegrees: -90 },
  },
  mainGirders: {
    positiveEdge: { origin: [4_945.5, 1_675, -356] as const, bearingDegrees: 0 },
    centre: { origin: [4_945.5, 0, -356] as const, bearingDegrees: 0 },
    negativeEdge: { origin: [4_945.5, -1_675, -356] as const, bearingDegrees: 0 },
  },
} as const;

export const ROAD_BRIDGE_DATUM = ROAD_BRIDGE_SET_OUT.datum;

export interface RoadDeckSetOutDimensions {
  readonly length: number;
  readonly width: number;
  readonly slabThickness: number;
  readonly setoutInset: number;
}

/** Derive deck and edge-railing control points from the bridge-centre Datum. */
export function roadDeckSetOut({
  length,
  width,
  slabThickness,
  setoutInset,
}: RoadDeckSetOutDimensions) {
  const longitudinalControl = length / 2 - setoutInset;
  const transverseEdge = width / 2;

  return {
    slab: {
      origin: [longitudinalControl, -(transverseEdge - setoutInset), -slabThickness] as const,
      bearingDegrees: 180,
    },
    positiveEdgeRailing: {
      origin: [longitudinalControl, transverseEdge, 0] as const,
      bearingDegrees: 0,
    },
    negativeEdgeRailing: {
      origin: [longitudinalControl, -transverseEdge, 0] as const,
      bearingDegrees: 180,
    },
  } as const;
}

export const RAIL_BRIDGE_SET_OUTS = [
  { origin: [17_320.508, 50_000, 0] as const, bearingDegrees: 60 },
  { origin: [34_641.016, 40_000, 0] as const, bearingDegrees: 60 },
] as const;
