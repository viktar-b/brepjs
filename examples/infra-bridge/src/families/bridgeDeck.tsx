/** @jsxImportSource brepjs-families */

import { csg } from 'brepjs';
import { el, family, type EngineeringSemantics } from 'brepjs-families';
import { z } from 'zod';

const bridgeDeckProps = z.object({
  length: z.number().positive(),
  width: z.number().positive(),
  thickness: z.number().positive(),
  setoutInset: z.number().nonnegative().default(0),
  material: z.string().trim().min(1),
  name: z.string().trim().min(1).default('Bridge deck'),
});

export type BridgeDeckProps = z.output<typeof bridgeDeckProps>;
export type BridgeDeckInput = z.input<typeof bridgeDeckProps>;

function semantics(props: BridgeDeckProps): EngineeringSemantics {
  return {
    kind: 'slab',
    role: 'deck',
    material: props.material,
    properties: {
      name: props.name,
      length: props.length,
      width: props.width,
      height: props.thickness,
      setoutInset: props.setoutInset,
      datum: 'lower-setout-point',
    },
  };
}

/** Flat deck slab; +X is longitudinal, +Y transverse, and +Z upward. */
export const BridgeDeck = family<BridgeDeckProps, BridgeDeckInput>(
  'BridgeDeck',
  ({ length, width, thickness, setoutInset }) =>
    el('Geometry', {
      node: csg.translate(csg.box(length, width, thickness), [
        -setoutInset,
        -(width - setoutInset),
        0,
      ]),
    }),
  { props: bridgeDeckProps, semantics }
);
