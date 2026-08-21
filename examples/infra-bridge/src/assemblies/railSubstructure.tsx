/** @jsxImportSource brepjs-families */

import { assembly, el, type EngineeringSemantics } from 'brepjs-families';
import { z } from 'zod';
import { yawFrame } from '../frames.js';
import { RailPier } from './railPier.js';

const railSubstructureProps = z.object({
  pierLongitudinalSetout: z.number().positive().default(5_000),
  pierTransverseSetout: z.number().default(-2_200),
  pierBaseElevation: z.number().default(-490),
  name: z.string().trim().min(1).default('Rail bridge substructure'),
});

export type RailSubstructureProps = z.output<typeof railSubstructureProps>;
export type RailSubstructureInput = z.input<typeof railSubstructureProps>;

function semantics(props: RailSubstructureProps): EngineeringSemantics {
  return {
    kind: 'bridge-part',
    role: 'substructure',
    properties: { name: props.name, usage: 'region' },
  };
}

/** Two explicit rail-pier BridgeParts around one substructure frame. */
export const RailSubstructure = assembly<RailSubstructureProps, RailSubstructureInput>(
  'RailSubstructure',
  ({ pierLongitudinalSetout, pierTransverseSetout, pierBaseElevation }) => {
    const pierOccurrences = [
      { key: 'pier-01', longitudinalSetOut: -pierLongitudinalSetout },
      { key: 'pier-02', longitudinalSetOut: pierLongitudinalSetout },
    ] as const;

    return el(
      'Group',
      {},
      pierOccurrences.map(({ key, longitudinalSetOut }) => (
        <RailPier
          key={key}
          frame={yawFrame([longitudinalSetOut, pierTransverseSetout, pierBaseElevation])}
        />
      ))
    );
  },
  { props: railSubstructureProps, semantics }
);
