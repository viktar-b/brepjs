/** @jsxImportSource brepjs-families */

import { assembly, el, type EngineeringSemantics } from 'brepjs-families';
import { z } from 'zod';
import { CrossGirder } from '../families/crossGirder.js';
import { Footing } from '../families/footing.js';
import { PierStem } from '../families/pierStem.js';
import { yawFrame } from '../frames.js';

const roadPierProps = z.object({
  concreteMaterial: z.string().trim().min(1),
  stemMaterial: z.string().trim().min(1),
  girderMaterial: z.string().trim().min(1),
  crossGirderSide: z.enum(['positive', 'negative']).default('positive'),
  footingLength: z.number().positive().default(5_000),
  footingWidth: z.number().positive().default(2_100),
  footingThickness: z.number().positive().default(700),
  stemLength: z.number().positive().default(3_600),
  stemWidth: z.number().positive().default(550),
  stemHeight: z.number().positive().default(2_286.321),
  capOffset: z.number().nonnegative().default(756),
  crossGirderLength: z.number().positive().default(4_000),
  crossGirderWidth: z.number().positive().default(300),
  crossGirderDepth: z.number().positive().default(400),
  crossGirderSetout: z.number().default(2_000),
  crossGirderInset: z.number().nonnegative().default(150),
  name: z.string().trim().min(1).default('Road pier'),
});

export type RoadPierProps = z.output<typeof roadPierProps>;
export type RoadPierInput = z.input<typeof roadPierProps>;

function semantics(props: RoadPierProps): EngineeringSemantics {
  return {
    kind: 'bridge-part',
    role: 'pier',
    properties: { name: props.name, usage: 'vertical' },
  };
}

/** Reusable road-pier composition around the pier-cap control point. */
export const RoadPier = assembly<RoadPierProps, RoadPierInput>(
  'RoadPier',
  ({
    concreteMaterial,
    stemMaterial,
    girderMaterial,
    crossGirderSide,
    footingLength,
    footingWidth,
    footingThickness,
    stemLength,
    stemWidth,
    stemHeight,
    capOffset,
    crossGirderLength,
    crossGirderWidth,
    crossGirderDepth,
    crossGirderSetout,
    crossGirderInset,
  }) =>
    el('Group', {}, [
      <CrossGirder
        key="cross-girder"
        frame={yawFrame([
          crossGirderSetout,
          crossGirderSide === 'positive' ? -crossGirderInset : crossGirderInset,
          -capOffset,
        ])}
        length={crossGirderLength}
        width={crossGirderWidth}
        depth={crossGirderDepth}
        transverseSide={crossGirderSide}
        material={girderMaterial}
      />,
      <PierStem
        key="pier-stem"
        length={stemLength}
        width={stemWidth}
        height={stemHeight}
        capOffset={capOffset}
        material={stemMaterial}
      />,
      <Footing
        key="footing"
        frame={yawFrame([0, 0, -(capOffset + stemHeight)])}
        length={footingLength}
        width={footingWidth}
        thickness={footingThickness}
        material={concreteMaterial}
      />,
    ]),
  { props: roadPierProps, semantics }
);
