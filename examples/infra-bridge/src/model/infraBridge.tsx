/** @jsxImportSource brepjs-families */

import { model } from 'brepjs-families';
import { z } from 'zod';
import { RailSite } from '../assemblies/railSite.js';
import { RoadSite } from '../assemblies/roadSite.js';
import { yawFrame } from '../frames.js';
import { RAIL_BRIDGE_SET_OUTS, ROAD_SITE_SET_OUT } from '../setout.js';

const emptyProps = z.object({});
type EmptyProps = z.output<typeof emptyProps>;
type EmptyInput = z.input<typeof emptyProps>;

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
