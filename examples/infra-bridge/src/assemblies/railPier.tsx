/** @jsxImportSource brepjs-families */

import { assembly, el, type EngineeringSemantics } from 'brepjs-families';
import { z } from 'zod';
import { Footing } from '../families/footing.js';
import { RailPierStem } from '../families/railPierStem.js';
import { yawFrame } from '../frames.js';
import { MATERIALS } from '../materials.js';

const railPierProps = z.object({
  stemLongitudinalWidth: z.number().positive().default(1_500),
  stemTransverseLength: z.number().positive().default(4_400),
  stemHeight: z.number().positive().default(3_780.346),
  footingLength: z.number().positive().default(6_400),
  footingWidth: z.number().positive().default(3_500),
  footingThickness: z.number().positive().default(1_000),
  name: z.string().trim().min(1).default('Rail bridge pier'),
});

export type RailPierProps = z.output<typeof railPierProps>;
export type RailPierInput = z.input<typeof railPierProps>;

function semantics(props: RailPierProps): EngineeringSemantics {
  return {
    kind: 'bridge-part',
    role: 'pier',
    properties: { name: props.name, usage: 'vertical' },
  };
}

/** Reusable masonry rail pier with a centred transverse footing. */
export const RailPier = assembly<RailPierProps, RailPierInput>(
  'RailPier',
  ({
    stemLongitudinalWidth,
    stemTransverseLength,
    stemHeight,
    footingLength,
    footingWidth,
    footingThickness,
  }) =>
    el('Group', {}, [
      <RailPierStem
        key="pier-stem"
        longitudinalWidth={stemLongitudinalWidth}
        transverseLength={stemTransverseLength}
        height={stemHeight}
        material={MATERIALS.graniteMasonry}
      />,
      <Footing
        key="footing"
        frame={yawFrame([0, stemTransverseLength / 2, 0], -90)}
        length={footingLength}
        width={footingWidth}
        thickness={footingThickness}
        material={MATERIALS.reinforcedConcrete}
        name="Foundation - rail bridge"
      />,
    ]),
  { props: railPierProps, semantics }
);
