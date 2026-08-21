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

/** Three explicit longitudinal girder Occurrences at reviewable transverse set-outs. */
export const RoadSuperstructure = assembly<RoadSuperstructureProps, RoadSuperstructureInput>(
  'RoadSuperstructure',
  ({ girderLength, girderWidth, girderDepth }) =>
    el('Group', {}, [
      <MainGirder
        key="main-girder-01"
        frame={yawFrame(
          ROAD_BRIDGE_SET_OUT.mainGirders.positiveEdge.origin,
          ROAD_BRIDGE_SET_OUT.mainGirders.positiveEdge.bearingDegrees
        )}
        length={girderLength}
        width={girderWidth}
        depth={girderDepth}
        material={MATERIALS.bridgeTimber}
        name="Road river bridge - main girder"
      />,
      <MainGirder
        key="main-girder-02"
        frame={yawFrame(
          ROAD_BRIDGE_SET_OUT.mainGirders.centre.origin,
          ROAD_BRIDGE_SET_OUT.mainGirders.centre.bearingDegrees
        )}
        length={girderLength}
        width={girderWidth}
        depth={girderDepth}
        material={MATERIALS.bridgeTimber}
        name="Road river bridge - main girder"
      />,
      <MainGirder
        key="main-girder-03"
        frame={yawFrame(
          ROAD_BRIDGE_SET_OUT.mainGirders.negativeEdge.origin,
          ROAD_BRIDGE_SET_OUT.mainGirders.negativeEdge.bearingDegrees
        )}
        length={girderLength}
        width={girderWidth}
        depth={girderDepth}
        material={MATERIALS.bridgeTimber}
        name="Road river bridge - main girder"
      />,
    ]),
  { props: roadSuperstructureProps, semantics }
);
