/** Human-authored civil control points and bearings, in millimetres and degrees. */
export const ROAD_SITE_SET_OUT = {
  origin: [17_320.508, 30_000, 0] as const,
  bearingDegrees: 120,
} as const;

export const ROAD_BRIDGE_DATUM = {
  origin: [0, 0, 242.321] as const,
  bearingFromSiteDegrees: -90,
} as const;

export const RAIL_BRIDGE_SET_OUTS = [
  { origin: [17_320.508, 50_000, 0] as const, bearingDegrees: 60 },
  { origin: [34_641.016, 40_000, 0] as const, bearingDegrees: 60 },
] as const;
