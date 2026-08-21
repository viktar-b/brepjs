/** @jsxImportSource brepjs-families */

import { assembly, el, type EngineeringSemantics } from 'brepjs-families';
import { z } from 'zod';
import { yawFrame } from '../frames.js';
import { MATERIALS } from '../materials.js';
import { ROAD_BRIDGE_SET_OUT } from '../setout.js';
import { RoadPier } from './roadPier.js';

const emptyProps = z.object({});
type EmptyProps = z.output<typeof emptyProps>;
type EmptyInput = z.input<typeof emptyProps>;

const semantics: EngineeringSemantics = {
  kind: 'bridge-part',
  role: 'substructure',
  properties: { name: 'Road bridge substructure', usage: 'region' },
};

const roadPierOccurrences = [
  {
    key: 'pier-01',
    setOut: ROAD_BRIDGE_SET_OUT.piers.start,
    crossGirderSide: 'negative',
  },
  {
    key: 'pier-02',
    setOut: ROAD_BRIDGE_SET_OUT.piers.centre,
    crossGirderSide: 'positive',
  },
  {
    key: 'pier-03',
    setOut: ROAD_BRIDGE_SET_OUT.piers.end,
    crossGirderSide: 'negative',
  },
] as const;

/** Three keyed road piers; outer cross-girders face inward toward the deck. */
export const RoadSubstructure = assembly<EmptyProps, EmptyInput>(
  'RoadSubstructure',
  () => {
    const pierMaterials = {
      concreteMaterial: MATERIALS.reinforcedConcrete,
      stemMaterial: MATERIALS.graniteMasonry,
      girderMaterial: MATERIALS.bridgeTimber,
    } as const;

    return el(
      'Group',
      {},
      roadPierOccurrences.map(({ key, setOut, crossGirderSide }) => (
        <RoadPier
          key={key}
          frame={yawFrame(setOut.origin, setOut.bearingDegrees)}
          crossGirderSide={crossGirderSide}
          {...pierMaterials}
        />
      ))
    );
  },
  { props: emptyProps, semantics }
);
