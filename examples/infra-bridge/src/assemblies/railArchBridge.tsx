/** @jsxImportSource brepjs-families */

import { assembly, el, type EngineeringSemantics } from 'brepjs-families';
import { z } from 'zod';
import { yawFrame } from '../frames.js';
import { RailArchSuperstructure } from './railArchSuperstructure.js';
import { RailSubstructure } from './railSubstructure.js';

const railArchBridgeProps = z.object({
  name: z.string().trim().min(1).default('Rail bridge'),
  pierLongitudinalSetout: z.number().positive().default(5_000),
  pierTransverseSetout: z.number().default(-2_200),
  pierBaseElevation: z.number().default(-490),
});

export type RailArchBridgeProps = z.output<typeof railArchBridgeProps>;
export type RailArchBridgeInput = z.input<typeof railArchBridgeProps>;

function semantics(props: RailArchBridgeProps): EngineeringSemantics {
  return {
    kind: 'bridge',
    role: 'arched',
    properties: { name: props.name },
  };
}

/** One parameterized rail-arch Bridge definition, intended for repeated instantiation. */
export const RailArchBridge = assembly<RailArchBridgeProps, RailArchBridgeInput>(
  'RailArchBridge',
  ({ pierLongitudinalSetout, pierTransverseSetout, pierBaseElevation }) => {
    const componentFrame = yawFrame([0, 0, 0], -90);
    return el('Group', {}, [
      <RailArchSuperstructure key="superstructure" frame={componentFrame} />,
      <RailSubstructure
        key="substructure"
        frame={componentFrame}
        pierLongitudinalSetout={pierLongitudinalSetout}
        pierTransverseSetout={pierTransverseSetout}
        pierBaseElevation={pierBaseElevation}
      />,
    ]);
  },
  { props: railArchBridgeProps, semantics }
);
