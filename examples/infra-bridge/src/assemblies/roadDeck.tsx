/** @jsxImportSource brepjs-families */

import { assembly, el, type EngineeringSemantics } from 'brepjs-families';
import { z } from 'zod';
import { BridgeDeck } from '../families/bridgeDeck.js';
import { RoadRailing } from '../families/roadRailing.js';
import { yawFrame } from '../frames.js';
import { MATERIALS } from '../materials.js';

const emptyProps = z.object({ label: z.string().optional() });
type EmptyProps = z.output<typeof emptyProps>;
type EmptyInput = z.input<typeof emptyProps>;

const semantics: EngineeringSemantics = {
  kind: 'bridge-part',
  role: 'deck',
  properties: { name: 'Road bridge deck', usage: 'region' },
};

/** Deck slab and both keyed edge guardrails around the bridge control Datum. */
export const RoadDeck = assembly<EmptyProps, EmptyInput>(
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
        name="Road river bridge - bridge deck"
      />,
      <RoadRailing
        key="railing-01"
        frame={yawFrame([4_945.5, 1_684, 0])}
        length={9_909}
        setoutInset={9}
        longitudinalSide="negative"
        railWidth={96}
        railHeight={196}
        lowerRailBase={-56}
        upperRailBase={404}
        postPitch={900}
        postThickness={96}
        postRunIn={847.5}
        postRunOut={114}
        material={MATERIALS.bridgeTimber}
      />,
      <RoadRailing
        key="railing-02"
        frame={yawFrame([4_945.5, -1_684, 0], 180)}
        length={9_909}
        setoutInset={9}
        longitudinalSide="positive"
        railWidth={96}
        railHeight={196}
        lowerRailBase={-56}
        upperRailBase={404}
        postPitch={900}
        postThickness={96}
        postRunIn={847.5}
        postRunOut={114}
        material={MATERIALS.bridgeTimber}
      />,
    ]),
  { props: emptyProps, semantics }
);
