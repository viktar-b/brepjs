/** @jsxImportSource brepjs-families */

import { csg } from 'brepjs';
import { el, family, type EngineeringSemantics } from 'brepjs-families';
import { z } from 'zod';

const pierStemProps = z.object({
  length: z.number().positive(),
  width: z.number().positive(),
  height: z.number().positive(),
  capOffset: z.number().nonnegative(),
  material: z.string().trim().min(1),
  name: z.string().trim().min(1).default('Pier stem'),
});

export type PierStemProps = z.output<typeof pierStemProps>;
export type PierStemInput = z.input<typeof pierStemProps>;

function semantics(props: PierStemProps): EngineeringSemantics {
  return {
    kind: 'column',
    role: 'pier-stem',
    material: props.material,
    properties: {
      name: props.name,
      length: props.length,
      width: props.width,
      height: props.height,
      capOffset: props.capOffset,
      datum: 'pier-cap-control-point',
    },
  };
}

/** Rectangular stem below a pier-cap control Datum in engineering coordinates. */
export const PierStem = family<PierStemProps, PierStemInput>(
  'PierStem',
  ({ length, width, height, capOffset }) =>
    el('Geometry', {
      node: csg.translate(csg.box(length, width, height), [
        -length / 2,
        -width / 2,
        -(capOffset + height),
      ]),
    }),
  { props: pierStemProps, semantics }
);
