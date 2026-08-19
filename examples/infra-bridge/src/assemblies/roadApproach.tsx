/** @jsxImportSource brepjs-families */

import { assembly, el, frame, type EngineeringSemantics } from 'brepjs-families';
import { z } from 'zod';
import { ApproachSlab } from '../families/approachSlab.js';
import { yawFrame } from '../frames.js';
import { MATERIALS } from '../materials.js';
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
    const radians = (sign * slopeDegrees * Math.PI) / 180;
    const slabFrame = frame({
      origin: [-116, sign * 2_443.111, -242.321],
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
        longitudinalSide={side === 'start' ? 'negative' : 'positive'}
        transverseSide="negative"
        material={MATERIALS.prefabricatedConcrete}
        name="Road bridge - approach slab"
      />,
      <RoadAbutment
        key="abutment"
        frame={yawFrame([-116, sign * 175, -756])}
        transverseSide={side === 'start' ? 'negative' : 'positive'}
        length={3_600}
        width={195}
        bearingInset={20}
        bearingSeatHeight={556.993}
        backHeight={539.493}
        material={MATERIALS.reinforcedConcrete}
      />,
    ]);
  },
  { props: roadApproachProps, semantics }
);
