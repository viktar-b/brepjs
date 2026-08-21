/** @jsxImportSource brepjs-families */

import { assembly, el, type EngineeringSemantics } from 'brepjs-families';
import { z } from 'zod';
import { BridgeDeck } from '../families/bridgeDeck.js';
import { RoadRailing } from '../families/roadRailing.js';
import { yawFrame } from '../frames.js';
import { MATERIALS } from '../materials.js';
import { roadDeckSetOut } from '../setout.js';

const roadDeckProps = z.object({
  length: z.number().positive().default(9_909),
  width: z.number().positive().default(3_368),
  slabThickness: z.number().positive().default(56),
  setoutInset: z.number().nonnegative().default(9),
  railWidth: z.number().positive().default(96),
  railHeight: z.number().positive().default(196),
  upperRailBase: z.number().default(404),
  postPitch: z.number().positive().default(900),
  postThickness: z.number().positive().default(96),
  postRunIn: z.number().nonnegative().default(847.5),
  postRunOut: z.number().nonnegative().default(114),
  name: z.string().trim().min(1).default('Road bridge deck'),
});

export type RoadDeckProps = z.output<typeof roadDeckProps>;
export type RoadDeckInput = z.input<typeof roadDeckProps>;

function semantics({ name }: RoadDeckProps): EngineeringSemantics {
  return {
    kind: 'bridge-part',
    role: 'deck',
    properties: { name, usage: 'region' },
  };
}

/** Deck slab and both keyed edge guardrails around the bridge control Datum. */
export const RoadDeck = assembly<RoadDeckProps, RoadDeckInput>(
  'RoadDeck',
  ({
    length,
    width,
    slabThickness,
    setoutInset,
    railWidth,
    railHeight,
    upperRailBase,
    postPitch,
    postThickness,
    postRunIn,
    postRunOut,
  }) => {
    const setOut = roadDeckSetOut({ length, width, slabThickness, setoutInset });
    const railingProps = {
      length,
      setoutInset,
      railWidth,
      railHeight,
      lowerRailBase: -slabThickness,
      upperRailBase,
      postPitch,
      postThickness,
      postRunIn,
      postRunOut,
      material: MATERIALS.bridgeTimber,
    } as const;
    const railingOccurrences = [
      {
        key: 'railing-01',
        setOut: setOut.positiveEdgeRailing,
        longitudinalSide: 'negative',
      },
      {
        key: 'railing-02',
        setOut: setOut.negativeEdgeRailing,
        longitudinalSide: 'positive',
      },
    ] as const;

    return el('Group', {}, [
      <BridgeDeck
        key="bridge-deck"
        frame={yawFrame(setOut.slab.origin, setOut.slab.bearingDegrees)}
        length={length}
        width={width}
        thickness={slabThickness}
        setoutInset={setoutInset}
        material={MATERIALS.bridgeTimber}
        name="Road river bridge - bridge deck"
      />,
      ...railingOccurrences.map(({ key, setOut: railingSetOut, longitudinalSide }) => (
        <RoadRailing
          key={key}
          frame={yawFrame(railingSetOut.origin, railingSetOut.bearingDegrees)}
          longitudinalSide={longitudinalSide}
          {...railingProps}
        />
      )),
    ]);
  },
  { props: roadDeckProps, semantics }
);
