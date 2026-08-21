/** @jsxImportSource brepjs-families */

import { assembly, el, type EngineeringSemantics } from 'brepjs-families';
import { z } from 'zod';
import { yawFrame } from '../frames.js';
import { ROAD_BRIDGE_SET_OUT } from '../setout.js';
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
      <RoadApproach
        key="approach-01"
        frame={yawFrame(
          ROAD_BRIDGE_SET_OUT.approaches.start.origin,
          ROAD_BRIDGE_SET_OUT.approaches.start.bearingDegrees
        )}
        side="start"
      />,
      <RoadApproach
        key="approach-02"
        frame={yawFrame(
          ROAD_BRIDGE_SET_OUT.approaches.end.origin,
          ROAD_BRIDGE_SET_OUT.approaches.end.bearingDegrees
        )}
        side="end"
      />,
    ]),
  { props: emptyProps, semantics }
);
