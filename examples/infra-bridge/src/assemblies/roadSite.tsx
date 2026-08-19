/** @jsxImportSource brepjs-families */

import { assembly, type EngineeringSemantics } from 'brepjs-families';
import { z } from 'zod';
import { yawFrame } from '../frames.js';
import { ROAD_BRIDGE_DATUM } from '../setout.js';
import { RoadGirderBridge } from './roadGirderBridge.js';

const roadSiteProps = z.object({
  name: z.string().trim().min(1).default('Road river bridge site'),
});

export type RoadSiteProps = z.output<typeof roadSiteProps>;
export type RoadSiteInput = z.input<typeof roadSiteProps>;

function semantics({ name }: RoadSiteProps): EngineeringSemantics {
  return { kind: 'site', properties: { name } };
}

/** Civil Site containing the keyed road-girder Bridge occurrence. */
export const RoadSite = assembly<RoadSiteProps, RoadSiteInput>(
  'RoadSite',
  () => (
    <RoadGirderBridge
      key="road-river-bridge"
      frame={yawFrame(ROAD_BRIDGE_DATUM.origin, ROAD_BRIDGE_DATUM.bearingFromSiteDegrees)}
    />
  ),
  { props: roadSiteProps, semantics }
);
