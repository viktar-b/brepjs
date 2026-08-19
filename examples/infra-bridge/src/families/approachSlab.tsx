/** @jsxImportSource brepjs-families */

import { csg } from 'brepjs';
import { el, family, type EngineeringSemantics } from 'brepjs-families';
import { z } from 'zod';

const approachSlabProps = z.object({
  length: z.number().positive(),
  width: z.number().positive(),
  thickness: z.number().positive(),
  longitudinalSide: z.enum(['positive', 'negative']),
  transverseSide: z.enum(['positive', 'negative']).default('negative'),
  material: z.string().trim().min(1),
  name: z.string().trim().min(1).default('Approach slab'),
});

export type ApproachSlabProps = z.output<typeof approachSlabProps>;
export type ApproachSlabInput = z.input<typeof approachSlabProps>;

function semantics(props: ApproachSlabProps): EngineeringSemantics {
  return {
    kind: 'slab',
    role: 'deck',
    material: props.material,
    properties: {
      name: props.name,
      length: props.length,
      width: props.width,
      height: props.thickness,
      datum: 'upper-inner-corner',
    },
  };
}

/** Pitched road slab; +X follows traffic, +Y is transverse, and +Z is upward. */
export const ApproachSlab = family<ApproachSlabProps, ApproachSlabInput>(
  'ApproachSlab',
  ({ length, width, thickness, longitudinalSide, transverseSide }) =>
    el('Geometry', {
      node: csg.translate(csg.box(length, width, thickness), [
        longitudinalSide === 'positive' ? 0 : -length,
        transverseSide === 'positive' ? 0 : -width,
        -thickness,
      ]),
    }),
  { props: approachSlabProps, semantics }
);
