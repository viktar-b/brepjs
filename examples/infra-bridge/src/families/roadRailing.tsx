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
  postToeWidth: z.number().positive().default(290.055),
  postToeBase: z.number().default(-317.801),
  postBaseWidth: z.number().positive().default(116),
  postBase: z.number().default(-336),
  postTransitionBase: z.number().default(-56),
  postShaftWidth: z.number().positive().default(96),
  postTop: z.number().default(620),
  postCapWidth: z.number().positive().default(192),
  material: z.string().trim().min(1),
  name: z.string().trim().min(1).default('Road bridge railing'),
});

export type RoadRailingProps = z.output<typeof roadRailingProps>;
export type RoadRailingInput = z.input<typeof roadRailingProps>;

function semantics(props: RoadRailingProps): EngineeringSemantics {
  const direction = props.longitudinalSide === 'positive' ? 1 : -1;
  const railMin = direction > 0 ? -props.setoutInset : -(props.length - props.setoutInset);
  const railMax = railMin + props.length;
  const finalPost = props.length - props.postRunOut;
  const postMin =
    direction > 0 ? Math.min(0, finalPost) : -Math.max(0, finalPost) - props.postThickness;
  const postMax =
    direction > 0 ? Math.max(0, finalPost) + props.postThickness : -Math.min(0, finalPost);
  const minimumZ = Math.min(
    props.lowerRailBase,
    props.upperRailBase,
    props.postToeBase,
    props.postBase,
    props.postTransitionBase,
    props.postTop
  );
  const maximumZ = Math.max(
    props.lowerRailBase + props.railHeight,
    props.upperRailBase + props.railHeight,
    props.postToeBase,
    props.postBase,
    props.postTransitionBase,
    props.postTop
  );
  return {
    kind: 'railing',
    role: 'guardrail',
    material: props.material,
    properties: {
      name: props.name,
      length: Math.max(railMax, postMax) - Math.min(railMin, postMin),
      width: Math.max(
        props.railWidth,
        props.postToeWidth,
        props.postBaseWidth,
        props.postShaftWidth,
        props.postCapWidth
      ),
      height: maximumZ - minimumZ,
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
    postToeWidth,
    postToeBase,
    postBaseWidth,
    postBase,
    postTransitionBase,
    postShaftWidth,
    postTop,
    postCapWidth,
  }) => {
    const direction = longitudinalSide === 'positive' ? 1 : -1;
    const railStart = direction > 0 ? -setoutInset : -(length - setoutInset);
    const railLength = length;
    const rails = [lowerRailBase, upperRailBase].map((base) =>
      csg.translate(csg.box(railLength, railWidth, railHeight), [railStart, 0, base])
    );
    const postProfile = csg.polygon([
      [0, postToeWidth, postToeBase],
      [0, postBaseWidth, postBase],
      [0, postBaseWidth, postTransitionBase],
      [0, postShaftWidth, postTransitionBase],
      [0, postShaftWidth, postTop],
      [0, postCapWidth, postTop],
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
