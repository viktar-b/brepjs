/** @jsxImportSource brepjs-families */

import { csg } from 'brepjs';
import { el, family, type EngineeringSemantics } from 'brepjs-families';
import { z } from 'zod';

const footingProps = z.object({
  length: z.number().positive(),
  width: z.number().positive(),
  thickness: z.number().positive(),
  material: z.string().trim().min(1),
  name: z.string().trim().min(1).default('Pier footing'),
});

export type FootingProps = z.output<typeof footingProps>;
export type FootingInput = z.input<typeof footingProps>;

function semantics(props: FootingProps): EngineeringSemantics {
  return {
    kind: 'footing',
    role: 'pad',
    material: props.material,
    properties: {
      name: props.name,
      length: props.length,
      width: props.width,
      height: props.thickness,
      datum: 'top-centre',
    },
  };
}

/** Rectangular footing below its top-centre Datum in engineering coordinates. */
export const Footing = family<FootingProps, FootingInput>(
  'Footing',
  ({ length, width, thickness }) =>
    el('Geometry', {
      node: csg.translate(csg.box(length, width, thickness), [-length / 2, -width / 2, -thickness]),
    }),
  { props: footingProps, semantics }
);
