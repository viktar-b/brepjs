/** @jsxImportSource brepjs-families */

import { assembly, el, type EngineeringSemantics } from 'brepjs-families';
import { z } from 'zod';
import { MainGirder } from '../families/mainGirder.js';
import { yawFrame } from '../frames.js';
import { MATERIALS } from '../materials.js';
import { ROAD_BRIDGE_SET_OUT } from '../setout.js';

const roadSuperstructureProps = z.object({
  girderLength: z.number().positive().default(9_891),
  girderWidth: z.number().positive().default(250),
  girderDepth: z.number().positive().default(300),
  name: z.string().trim().min(1).default('Road bridge superstructure'),
});

export type RoadSuperstructureProps = z.output<typeof roadSuperstructureProps>;
export type RoadSuperstructureInput = z.input<typeof roadSuperstructureProps>;

function semantics({ name }: RoadSuperstructureProps): EngineeringSemantics {
  return {
    kind: 'bridge-part',
    role: 'superstructure',
    properties: { name, usage: 'longitudinal' },
  };
}

const mainGirderOccurrences = [
  {
    key: 'main-girder-01',
    setOut: ROAD_BRIDGE_SET_OUT.mainGirders.positiveEdge,
  },
  {
    key: 'main-girder-02',
    setOut: ROAD_BRIDGE_SET_OUT.mainGirders.centre,
  },
  {
    key: 'main-girder-03',
    setOut: ROAD_BRIDGE_SET_OUT.mainGirders.negativeEdge,
  },
] as const;

/** Three explicit longitudinal girder Occurrences at reviewable transverse set-outs. */
export const RoadSuperstructure = assembly<RoadSuperstructureProps, RoadSuperstructureInput>(
  'RoadSuperstructure',
  ({ girderLength, girderWidth, girderDepth }) => {
    const girderProps = {
      length: girderLength,
      width: girderWidth,
      depth: girderDepth,
      material: MATERIALS.bridgeTimber,
      name: 'Road river bridge - main girder',
    } as const;

    return el(
      'Group',
      {},
      mainGirderOccurrences.map(({ key, setOut }) => (
        <MainGirder
          key={key}
          frame={yawFrame(setOut.origin, setOut.bearingDegrees)}
          {...girderProps}
        />
      ))
    );
  },
  { props: roadSuperstructureProps, semantics }
);
