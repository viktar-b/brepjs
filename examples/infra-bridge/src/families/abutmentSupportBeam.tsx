/** @jsxImportSource brepjs-families */

import { csg } from 'brepjs';
import { el, family, type EngineeringSemantics } from 'brepjs-families';
import { z } from 'zod';

const abutmentSupportBeamProps = z.object({
  length: z.number().positive(),
  width: z.number().positive(),
  bearingInset: z.number().positive(),
  bearingSeatHeight: z.number().positive(),
  backHeight: z.number().positive(),
  transverseSide: z.enum(['positive', 'negative']),
  material: z.string().trim().min(1),
  name: z.string().trim().min(1).default('Abutment support beam'),
});

export type AbutmentSupportBeamProps = z.output<typeof abutmentSupportBeamProps>;
export type AbutmentSupportBeamInput = z.input<typeof abutmentSupportBeamProps>;

function semantics(props: AbutmentSupportBeamProps): EngineeringSemantics {
  return {
    kind: 'beam',
    role: 'beam',
    material: props.material,
    properties: {
      name: props.name,
      length: props.length,
      width: props.width,
      height: props.bearingSeatHeight,
      datum: 'lower-end-corner',
    },
  };
}

/** Five-point bearing-seat profile extruded along the beam member axis. */
export const AbutmentSupportBeam = family<AbutmentSupportBeamProps, AbutmentSupportBeamInput>(
  'AbutmentSupportBeam',
  ({ length, width, bearingInset, bearingSeatHeight, backHeight, transverseSide }) => {
    const side = transverseSide === 'positive' ? 1 : -1;
    const shoulder = width - bearingInset;
    const profile = csg.polygon([
      [0, 0, 0],
      [0, side * width, 0],
      [0, side * shoulder, bearingInset],
      [0, side * shoulder, bearingSeatHeight],
      [0, 0, backHeight],
    ]);
    return el('Geometry', { node: csg.extrude(profile, [length, 0, 0]) });
  },
  { props: abutmentSupportBeamProps, semantics }
);
