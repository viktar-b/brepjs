/** @jsxImportSource brepjs-families */

import { assembly, el, type EngineeringSemantics } from 'brepjs-families';
import { z } from 'zod';
import { yawFrame } from '../frames.js';
import { MATERIALS } from '../materials.js';
import { ROAD_BRIDGE_SET_OUT } from '../setout.js';
import { RoadPier } from './roadPier.js';

const emptyProps = z.object({ label: z.string().optional() });
type EmptyProps = z.output<typeof emptyProps>;
type EmptyInput = z.input<typeof emptyProps>;

const semantics: EngineeringSemantics = {
  kind: 'bridge-part',
  role: 'substructure',
  properties: { name: 'Road bridge substructure', usage: 'region' },
};

/** Three keyed road piers; outer cross-girders face inward toward the deck. */
export const RoadSubstructure = assembly<EmptyProps, EmptyInput>(
  'RoadSubstructure',
  () =>
    el('Group', {}, [
      <RoadPier
        key="pier-01"
        frame={yawFrame(
          ROAD_BRIDGE_SET_OUT.piers.start.origin,
          ROAD_BRIDGE_SET_OUT.piers.start.bearingDegrees
        )}
        concreteMaterial={MATERIALS.reinforcedConcrete}
        stemMaterial={MATERIALS.graniteMasonry}
        girderMaterial={MATERIALS.bridgeTimber}
        crossGirderSide="negative"
      />,
      <RoadPier
        key="pier-02"
        frame={yawFrame(
          ROAD_BRIDGE_SET_OUT.piers.centre.origin,
          ROAD_BRIDGE_SET_OUT.piers.centre.bearingDegrees
        )}
        concreteMaterial={MATERIALS.reinforcedConcrete}
        stemMaterial={MATERIALS.graniteMasonry}
        girderMaterial={MATERIALS.bridgeTimber}
        crossGirderSide="positive"
      />,
      <RoadPier
        key="pier-03"
        frame={yawFrame(
          ROAD_BRIDGE_SET_OUT.piers.end.origin,
          ROAD_BRIDGE_SET_OUT.piers.end.bearingDegrees
        )}
        concreteMaterial={MATERIALS.reinforcedConcrete}
        stemMaterial={MATERIALS.graniteMasonry}
        girderMaterial={MATERIALS.bridgeTimber}
        crossGirderSide="negative"
      />,
    ]),
  { props: emptyProps, semantics }
);
