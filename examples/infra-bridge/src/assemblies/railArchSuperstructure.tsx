/** @jsxImportSource brepjs-families */

import { assembly, el, type EngineeringSemantics } from 'brepjs-families';
import { z } from 'zod';
import { ArchSegment } from '../families/archSegment.js';
import { BridgeNameSign } from '../families/bridgeNameSign.js';
import { EarthFill } from '../families/earthFill.js';
import { SpandrelWall } from '../families/spandrelWall.js';
import { yawFrame } from '../frames.js';
import { MATERIALS } from '../materials.js';

const railArchSuperstructureProps = z.object({
  halfSpan: z.number().positive().default(5_000),
  halfWidth: z.number().positive().default(1_750),
  outerRise: z.number().positive().default(4_084.236),
  innerRun: z.number().positive().default(4_250),
  innerRise: z.number().positive().default(3_333.333),
  archBandThickness: z.number().positive().default(750),
  baseElevation: z.number().default(3_290.346),
  wallOffset: z.number().positive().default(2_200),
  wallThickness: z.number().positive().default(450),
  signElevation: z.number().default(7_024.582),
  name: z.string().trim().min(1).default('Rail arch superstructure'),
});

export type RailArchSuperstructureProps = z.output<typeof railArchSuperstructureProps>;
export type RailArchSuperstructureInput = z.input<typeof railArchSuperstructureProps>;

function semantics(props: RailArchSuperstructureProps): EngineeringSemantics {
  return {
    kind: 'bridge-part',
    role: 'superstructure',
    properties: { name: props.name, usage: 'longitudinal' },
  };
}

/** Symmetric two-span masonry arch superstructure with explicit major Occurrences. */
export const RailArchSuperstructure = assembly<
  RailArchSuperstructureProps,
  RailArchSuperstructureInput
>(
  'RailArchSuperstructure',
  ({
    halfSpan,
    halfWidth,
    outerRise,
    innerRun,
    innerRise,
    archBandThickness,
    baseElevation,
    wallOffset,
    wallThickness,
    signElevation,
  }) => {
    const archProps = {
      outerRun: halfSpan,
      outerRise,
      innerRun,
      innerRise,
      bandThickness: archBandThickness,
      halfWidth,
      material: MATERIALS.graniteMasonry,
    } as const;
    return el('Group', {}, [
      <EarthFill
        key="filler-01"
        frame={yawFrame([-halfSpan, 0, baseElevation])}
        halfSpan={halfSpan}
        halfWidth={halfWidth}
        crownRise={outerRise}
        material={MATERIALS.genericSoil}
      />,
      <EarthFill
        key="filler-02"
        frame={yawFrame([halfSpan, 0, baseElevation])}
        halfSpan={halfSpan}
        halfWidth={halfWidth}
        crownRise={outerRise}
        material={MATERIALS.genericSoil}
      />,
      <ArchSegment
        key="arch-segment-01"
        frame={yawFrame([-halfSpan - archBandThickness, 0, baseElevation], 180)}
        {...archProps}
      />,
      <ArchSegment
        key="arch-segment-02"
        frame={yawFrame([-innerRun, 0, baseElevation])}
        {...archProps}
      />,
      <ArchSegment
        key="arch-segment-03"
        frame={yawFrame([innerRun, 0, baseElevation], 180)}
        {...archProps}
      />,
      <ArchSegment
        key="arch-segment-04"
        frame={yawFrame([halfSpan + archBandThickness, 0, baseElevation])}
        {...archProps}
      />,
      <BridgeNameSign
        key="name-sign-01"
        frame={yawFrame([0, -wallOffset, signElevation])}
        text="BREPJS"
        width={1_600}
        height={400}
        plateDepth={30}
        reliefDepth={20}
        material={MATERIALS.copper}
        name="Road rail bridge - name sign"
      />,
      <BridgeNameSign
        key="name-sign-02"
        frame={yawFrame([0, wallOffset, signElevation], 180)}
        text="BREPJS"
        width={1_600}
        height={400}
        plateDepth={30}
        reliefDepth={20}
        material={MATERIALS.copper}
        name="Road rail bridge - name sign"
      />,
      <SpandrelWall
        key="spandrel-wall-01"
        frame={yawFrame([-halfSpan * 2, -wallOffset, baseElevation])}
        length={halfSpan * 4}
        thickness={wallThickness}
        height={outerRise + 400}
        bayCount={2}
        openingRun={innerRun}
        openingRise={innerRise}
        material={MATERIALS.graniteMasonry}
      />,
      <SpandrelWall
        key="spandrel-wall-02"
        frame={yawFrame([halfSpan * 2, wallOffset, baseElevation], 180)}
        length={halfSpan * 4}
        thickness={wallThickness}
        height={outerRise + 400}
        bayCount={2}
        openingRun={innerRun}
        openingRise={innerRise}
        material={MATERIALS.graniteMasonry}
      />,
    ]);
  },
  { props: railArchSuperstructureProps, semantics }
);
