/** @jsxImportSource brepjs-families */

import { csg } from 'brepjs';
import { el, family, type EngineeringSemantics } from 'brepjs-families';
import { z } from 'zod';

const roadRailingProps = z.object({
  length: z.number().positive(),
  setoutInset: z.number().nonnegative(),
  longitudinalSide: z.enum(['positive', 'negative']),
  railWidth: z.number().positive(),
  railHeight: z.number().positive(),
  lowerRailBase: z.number(),
  upperRailBase: z.number(),
  postPitch: z.number().positive(),
  postThickness: z.number().positive(),
  postRunIn: z.number().nonnegative(),
  postRunOut: z.number().nonnegative(),
  material: z.string().trim().min(1),
  name: z.string().trim().min(1).default('Road bridge railing'),
});

export type RoadRailingProps = z.output<typeof roadRailingProps>;
export type RoadRailingInput = z.input<typeof roadRailingProps>;

function semantics(props: RoadRailingProps): EngineeringSemantics {
  return {
    kind: 'railing',
    role: 'guardrail',
    material: props.material,
    properties: {
      name: props.name,
      length: props.length,
      width: 290.055,
      height: 956,
      datum: 'deck-edge-control-point',
    },
  };
}

/** Timber guardrail generated from two rails and a repeated tapered post profile. */
export const RoadRailing = family<RoadRailingProps, RoadRailingInput>(
  'RoadRailing',
  ({
    length,
    setoutInset,
    longitudinalSide,
    railWidth,
    railHeight,
    lowerRailBase,
    upperRailBase,
    postPitch,
    postThickness,
    postRunIn,
    postRunOut,
  }) => {
    const direction = longitudinalSide === 'positive' ? 1 : -1;
    const railStart = direction > 0 ? -setoutInset : -(length - setoutInset);
    const railLength = length;
    const rails = [lowerRailBase, upperRailBase].map((base) =>
      csg.translate(csg.box(railLength, railWidth, railHeight), [railStart, 0, base])
    );
    const postProfile = csg.polygon([
      [0, 290.055, -317.801],
      [0, 116, -336],
      [0, 116, -56],
      [0, 96, -56],
      [0, 96, 620],
      [0, 192, 620],
    ]);
    const postStarts = [
      0,
      ...Array.from(
        { length: Math.max(0, Math.floor((length - postRunIn - postRunOut) / postPitch) + 1) },
        (_, index) => postRunIn + index * postPitch
      ),
      length - postRunOut,
    ];
    const posts = postStarts.map((distance) =>
      csg.translate(csg.extrude(postProfile, [direction * postThickness, 0, 0]), [
        direction * distance,
        0,
        0,
      ])
    );
    return el('Geometry', { node: csg.compound([...rails, ...posts]) });
  },
  { props: roadRailingProps, semantics }
);
