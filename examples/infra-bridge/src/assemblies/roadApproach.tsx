/** @jsxImportSource brepjs-families */

import { assembly, el, frame, type EngineeringSemantics } from 'brepjs-families';
import { z } from 'zod';
import { ApproachSlab } from '../families/approachSlab.js';
import { yawFrame } from '../frames.js';
import { MATERIALS } from '../materials.js';
import { ROAD_BRIDGE_SET_OUT } from '../setout.js';
import { RoadAbutment } from './roadAbutment.js';

const roadApproachProps = z.object({
  side: z.enum(['start', 'end']),
  slopeDegrees: z.number().positive().default(5.710593),
  slabLength: z.number().positive().default(2_435.296),
  slabWidth: z.number().positive().default(3_600),
  slabThickness: z.number().positive().default(200),
  name: z.string().trim().min(1).default('Road bridge approach'),
});

export type RoadApproachProps = z.output<typeof roadApproachProps>;
export type RoadApproachInput = z.input<typeof roadApproachProps>;

function semantics(props: RoadApproachProps): EngineeringSemantics {
  return {
    kind: 'bridge-part',
    role: 'surface-structure',
    properties: { name: props.name, usage: 'longitudinal' },
  };
}

/** One pitched approach slab and its nested abutment BridgePart. */
export const RoadApproach = assembly<RoadApproachProps, RoadApproachInput>(
  'RoadApproach',
  ({ side, slopeDegrees, slabLength, slabWidth, slabThickness }) => {
    const sign = side === 'start' ? 1 : -1;
    const structuralSide = side === 'start' ? 'negative' : 'positive';
    const radians = (sign * slopeDegrees * Math.PI) / 180;
    const { slab, abutment } = ROAD_BRIDGE_SET_OUT.approaches;
    const slabFrame = frame({
      origin: [slab.xOffset, sign * slab.runFromDeckEnd, slab.elevation],
      xAxis: [0, Math.cos(radians), -Math.sin(radians)],
      zAxis: [0, Math.sin(radians), Math.cos(radians)],
    });
    return el('Group', {}, [
      <ApproachSlab
        key="approach-slab"
        frame={slabFrame}
        length={slabLength}
        width={slabWidth}
        thickness={slabThickness}
        longitudinalSide={structuralSide}
        transverseSide="negative"
        material={MATERIALS.prefabricatedConcrete}
        name="Road bridge - approach slab"
      />,
      <RoadAbutment
        key="abutment"
        frame={yawFrame([abutment.xOffset, sign * abutment.runFromDeckEnd, abutment.elevation])}
        transverseSide={structuralSide}
        material={MATERIALS.reinforcedConcrete}
      />,
    ]);
  },
  { props: roadApproachProps, semantics }
);
