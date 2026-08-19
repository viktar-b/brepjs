/** @jsxImportSource brepjs-families */

import { csg } from 'brepjs';
import { el, family, type EngineeringSemantics } from 'brepjs-families';
import { z } from 'zod';

const railPierStemProps = z.object({
  longitudinalWidth: z.number().positive(),
  transverseLength: z.number().positive(),
  height: z.number().positive(),
  material: z.string().trim().min(1),
  name: z.string().trim().min(1).default('Rail bridge pier stem'),
});

export type RailPierStemProps = z.output<typeof railPierStemProps>;
export type RailPierStemInput = z.input<typeof railPierStemProps>;

function semantics(props: RailPierStemProps): EngineeringSemantics {
  return {
    kind: 'column',
    role: 'pier-stem',
    material: props.material,
    properties: {
      name: props.name,
      length: props.longitudinalWidth,
      width: props.transverseLength,
      height: props.height,
      datum: 'lower-longitudinal-centreline-corner',
    },
  };
}

/** Masonry rail pier: +X longitudinal, +Y transverse, +Z upward. */
export const RailPierStem = family<RailPierStemProps, RailPierStemInput>(
  'RailPierStem',
  ({ longitudinalWidth, transverseLength, height }) =>
    el('Geometry', {
      node: csg.translate(csg.box(longitudinalWidth, transverseLength, height), [
        -longitudinalWidth / 2,
        0,
        0,
      ]),
    }),
  { props: railPierStemProps, semantics }
);
