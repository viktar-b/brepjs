/** @jsxImportSource brepjs-families */

import { assembly, model, type EngineeringSemantics } from 'brepjs-families';
import { z } from 'zod';
import { RoadGirderBridge } from '../assemblies/roadGirderBridge.js';
import { yawFrame } from '../frames.js';
import { ROAD_BRIDGE_DATUM, ROAD_SITE_SET_OUT } from '../setout.js';

const emptyProps = z.object({ label: z.string().optional() });
type EmptyProps = z.output<typeof emptyProps>;
type EmptyInput = z.input<typeof emptyProps>;

const siteSemantics: EngineeringSemantics = {
  kind: 'site',
  properties: { name: 'Road river bridge site' },
};

const RoadSite = assembly<EmptyProps, EmptyInput>(
  'RoadSite',
  () => (
    <RoadGirderBridge
      key="road-river-bridge"
      frame={yawFrame(ROAD_BRIDGE_DATUM.origin, ROAD_BRIDGE_DATUM.bearingFromSiteDegrees)}
    />
  ),
  { props: emptyProps, semantics: siteSemantics }
);

/** Root authored infrastructure Model. */
export const InfraBridge = model<EmptyProps, EmptyInput>(
  'InfraBridge',
  () => (
    <RoadSite
      key="road-site"
      frame={yawFrame(ROAD_SITE_SET_OUT.origin, ROAD_SITE_SET_OUT.bearingDegrees)}
    />
  ),
  { props: emptyProps, semantics: { kind: 'project' } }
);
