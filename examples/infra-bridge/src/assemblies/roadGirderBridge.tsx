/** @jsxImportSource brepjs-families */

import { assembly, el, type EngineeringSemantics } from 'brepjs-families';
import { z } from 'zod';
import { yawFrame } from '../frames.js';
import { RoadApproach } from './roadApproach.js';
import { RoadDeck } from './roadDeck.js';
import { RoadSubstructure } from './roadSubstructure.js';
import { RoadSuperstructure } from './roadSuperstructure.js';

const emptyProps = z.object({ label: z.string().optional() });
type EmptyProps = z.output<typeof emptyProps>;
type EmptyInput = z.input<typeof emptyProps>;

const semantics: EngineeringSemantics = {
  kind: 'bridge',
  role: 'girder',
  properties: { name: 'Road river bridge' },
};

/** Complete keyed road-girder bridge hierarchy around one civil set-out Datum. */
export const RoadGirderBridge = assembly<EmptyProps, EmptyInput>(
  'RoadGirderBridge',
  () =>
    el('Group', {}, [
      <RoadSubstructure key="substructure" />,
      <RoadSuperstructure key="superstructure" />,
      <RoadDeck key="deck" />,
      <RoadApproach key="approach-01" frame={yawFrame([-4_945.5, -1_684, 0], 90)} side="start" />,
      <RoadApproach key="approach-02" frame={yawFrame([4_945.5, -1_684, 0], 90)} side="end" />,
    ]),
  { props: emptyProps, semantics }
);
