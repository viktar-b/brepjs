/** @jsxImportSource brepjs-families */

import { csg } from 'brepjs';
import { el, family, type EngineeringSemantics } from 'brepjs-families';
import { z } from 'zod';

const crossGirderProps = z.object({
  length: z.number().positive(),
  width: z.number().positive(),
  depth: z.number().positive(),
  transverseSide: z.enum(['positive', 'negative']).default('positive'),
  material: z.string().trim().min(1),
  name: z.string().trim().min(1).default('Cross girder'),
});

export type CrossGirderProps = z.output<typeof crossGirderProps>;
export type CrossGirderInput = z.input<typeof crossGirderProps>;

function semantics(props: CrossGirderProps): EngineeringSemantics {
  return {
    kind: 'beam',
    role: 'cross-girder',
    material: props.material,
    properties: {
      name: props.name,
      length: props.length,
      width: props.width,
      height: props.depth,
      datum: 'lower-end-corner',
    },
  };
}

/** Pier cross-girder extending along -X from its lower-end control Datum. */
export const CrossGirder = family<CrossGirderProps, CrossGirderInput>(
  'CrossGirder',
  ({ length, width, depth, transverseSide }) =>
    el('Geometry', {
      node: csg.translate(csg.box(length, width, depth), [
        -length,
        transverseSide === 'positive' ? 0 : -width,
        0,
      ]),
    }),
  { props: crossGirderProps, semantics }
);
