/** @jsxImportSource brepjs-families */

import { assembly, model, type EngineeringSemantics } from 'brepjs-families';
import { z } from 'zod';
import { RailArchBridge } from '../assemblies/railArchBridge.js';
import { RoadGirderBridge } from '../assemblies/roadGirderBridge.js';
import { yawFrame } from '../frames.js';
import { RAIL_BRIDGE_SET_OUTS, ROAD_BRIDGE_DATUM, ROAD_SITE_SET_OUT } from '../setout.js';

const emptyProps = z.object({ label: z.string().optional() });
type EmptyProps = z.output<typeof emptyProps>;
type EmptyInput = z.input<typeof emptyProps>;

function siteSemantics(name: string): EngineeringSemantics {
  return { kind: 'site', properties: { name } };
}

const RoadSite = assembly<EmptyProps, EmptyInput>(
  'RoadSite',
  () => (
    <RoadGirderBridge
      key="road-river-bridge"
      frame={yawFrame(ROAD_BRIDGE_DATUM.origin, ROAD_BRIDGE_DATUM.bearingFromSiteDegrees)}
    />
  ),
  { props: emptyProps, semantics: siteSemantics('Road river bridge site') }
);

const railSiteProps = z.object({
  bridgeKey: z.string().trim().min(1),
  bridgeName: z.string().trim().min(1).default('Rail bridge'),
  siteName: z.string().trim().min(1),
});
type RailSiteProps = z.output<typeof railSiteProps>;
type RailSiteInput = z.input<typeof railSiteProps>;

const RailSite = assembly<RailSiteProps, RailSiteInput>(
  'RailSite',
  ({ bridgeKey, bridgeName }) => <RailArchBridge key={bridgeKey} name={bridgeName} />,
  { props: railSiteProps, semantics: ({ siteName }) => siteSemantics(siteName) }
);

/** Root authored infrastructure Model with one road and two repeated rail bridges. */
export const InfraBridge = model<EmptyProps, EmptyInput>(
  'InfraBridge',
  () => (
    <>
      <RoadSite
        key="road-site"
        frame={yawFrame(ROAD_SITE_SET_OUT.origin, ROAD_SITE_SET_OUT.bearingDegrees)}
      />
      <RailSite
        key="rail-site-01"
        bridgeKey="rail-bridge-01"
        siteName="Rail bridge site 01"
        frame={yawFrame(RAIL_BRIDGE_SET_OUTS[0].origin, RAIL_BRIDGE_SET_OUTS[0].bearingDegrees)}
      />
      <RailSite
        key="rail-site-02"
        bridgeKey="rail-bridge-02"
        siteName="Rail bridge site 02"
        frame={yawFrame(RAIL_BRIDGE_SET_OUTS[1].origin, RAIL_BRIDGE_SET_OUTS[1].bearingDegrees)}
      />
    </>
  ),
  { props: emptyProps, semantics: { kind: 'project' } }
);
