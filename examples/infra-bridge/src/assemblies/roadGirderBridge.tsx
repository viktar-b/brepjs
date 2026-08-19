/** @jsxImportSource brepjs-families */

import { assembly, el, type EngineeringSemantics } from 'brepjs-families';
import { z } from 'zod';
import { BridgeDeck } from '../families/bridgeDeck.js';
import { MainGirder } from '../families/mainGirder.js';
import { yawFrame } from '../frames.js';
import { MATERIALS } from '../materials.js';
import { RoadPier } from './roadPier.js';

const emptyProps = z.object({ label: z.string().optional() });
type EmptyProps = z.output<typeof emptyProps>;
type EmptyInput = z.input<typeof emptyProps>;

const DeckPart = assembly<EmptyProps, EmptyInput>(
  'RoadDeck',
  () =>
    el('Group', {}, [
      <BridgeDeck
        key="bridge-deck"
        frame={yawFrame([4_945.5, -1_675, -56], 180)}
        length={9_909}
        width={3_368}
        thickness={56}
        setoutInset={9}
        material={MATERIALS.bridgeTimber}
      />,
      <MainGirder
        key="main-girder"
        frame={yawFrame([4_945.5, 0, -356])}
        length={9_891}
        width={250}
        depth={300}
        material={MATERIALS.bridgeTimber}
      />,
    ]),
  {
    props: emptyProps,
    semantics: {
      kind: 'bridge-part',
      role: 'deck',
      properties: { name: 'Road bridge deck', usage: 'region' },
    },
  }
);

const bridgeSemantics: EngineeringSemantics = {
  kind: 'bridge',
  role: 'girder',
  properties: { name: 'Road river bridge' },
};

/** Gate-3 road bridge vertical slice: one deck and one representative pier. */
export const RoadGirderBridge = assembly<EmptyProps, EmptyInput>(
  'RoadGirderBridge',
  () =>
    el('Group', {}, [
      <DeckPart key="deck" />,
      <RoadPier
        key="pier"
        frame={yawFrame([0, 0, 0], -90)}
        concreteMaterial={MATERIALS.reinforcedConcrete}
        stemMaterial={MATERIALS.graniteMasonry}
        girderMaterial={MATERIALS.bridgeTimber}
        crossGirderSide="positive"
      />,
    ]),
  { props: emptyProps, semantics: bridgeSemantics }
);
