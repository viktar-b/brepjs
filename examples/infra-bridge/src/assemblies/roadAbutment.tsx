/** @jsxImportSource brepjs-families */

import { assembly, el, type EngineeringSemantics } from 'brepjs-families';
import { z } from 'zod';
import { AbutmentSupportBeam } from '../families/abutmentSupportBeam.js';

const roadAbutmentProps = z.object({
  transverseSide: z.enum(['positive', 'negative']),
  length: z.number().positive().default(3_600),
  width: z.number().positive().default(195),
  bearingInset: z.number().positive().default(20),
  bearingSeatHeight: z.number().positive().default(556.993),
  backHeight: z.number().positive().default(539.493),
  material: z.string().trim().min(1),
  name: z.string().trim().min(1).default('Road bridge abutment'),
});

export type RoadAbutmentProps = z.output<typeof roadAbutmentProps>;
export type RoadAbutmentInput = z.input<typeof roadAbutmentProps>;

function semantics(props: RoadAbutmentProps): EngineeringSemantics {
  return {
    kind: 'bridge-part',
    role: 'abutment',
    properties: { name: props.name, usage: 'vertical' },
  };
}

/** Road abutment BridgePart around the lower support-beam Datum. */
export const RoadAbutment = assembly<RoadAbutmentProps, RoadAbutmentInput>(
  'RoadAbutment',
  ({ transverseSide, length, width, bearingInset, bearingSeatHeight, backHeight, material }) =>
    el('Group', {}, [
      <AbutmentSupportBeam
        key="abutment-support-beam"
        length={length}
        width={width}
        bearingInset={bearingInset}
        bearingSeatHeight={bearingSeatHeight}
        backHeight={backHeight}
        transverseSide={transverseSide}
        material={material}
        name="Road river bridge - abutment support beam"
      />,
    ]),
  { props: roadAbutmentProps, semantics }
);
