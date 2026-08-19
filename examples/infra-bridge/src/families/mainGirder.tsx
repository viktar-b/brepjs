/** @jsxImportSource brepjs-families */

import { csg } from 'brepjs';
import { el, family, type EngineeringSemantics } from 'brepjs-families';
import { z } from 'zod';

const mainGirderProps = z.object({
  length: z.number().positive(),
  width: z.number().positive(),
  depth: z.number().positive(),
  material: z.string().trim().min(1),
  name: z.string().trim().min(1).default('Main girder'),
});

export type MainGirderProps = z.output<typeof mainGirderProps>;
export type MainGirderInput = z.input<typeof mainGirderProps>;

function semantics(props: MainGirderProps): EngineeringSemantics {
  return {
    kind: 'beam',
    role: 'girder',
    material: props.material,
    properties: {
      name: props.name,
      length: props.length,
      width: props.width,
      height: props.depth,
      datum: 'lower-centreline-end',
    },
  };
}

/** Rectangular main girder extending along -X from its lower-centreline end Datum. */
export const MainGirder = family<MainGirderProps, MainGirderInput>(
  'MainGirder',
  ({ length, width, depth }) =>
    el('Geometry', {
      node: csg.translate(csg.box(length, width, depth), [-length, -width / 2, 0]),
    }),
  { props: mainGirderProps, semantics }
);
