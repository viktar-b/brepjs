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
    const fillProps = {
      halfSpan,
      halfWidth,
      crownRise: outerRise,
      material: MATERIALS.genericSoil,
    } as const;
    const signProps = {
      text: 'BREPJS',
      width: 1_600,
      height: 400,
      plateDepth: 30,
      reliefDepth: 20,
      material: MATERIALS.copper,
      name: 'Road rail bridge - name sign',
    } as const;
    const wallProps = {
      length: halfSpan * 4,
      thickness: wallThickness,
      height: outerRise + 400,
      bayCount: 2,
      openingRun: innerRun,
      openingRise: innerRise,
      material: MATERIALS.graniteMasonry,
    } as const;
    const fillOccurrences = [
      { key: 'filler-01', origin: [-halfSpan, 0, baseElevation] as const },
      { key: 'filler-02', origin: [halfSpan, 0, baseElevation] as const },
    ] as const;
    const archOccurrences = [
      {
        key: 'arch-segment-01',
        origin: [-halfSpan - archBandThickness, 0, baseElevation] as const,
        bearingDegrees: 180,
      },
      {
        key: 'arch-segment-02',
        origin: [-innerRun, 0, baseElevation] as const,
        bearingDegrees: 0,
      },
      {
        key: 'arch-segment-03',
        origin: [innerRun, 0, baseElevation] as const,
        bearingDegrees: 180,
      },
      {
        key: 'arch-segment-04',
        origin: [halfSpan + archBandThickness, 0, baseElevation] as const,
        bearingDegrees: 0,
      },
    ] as const;
    const signOccurrences = [
      {
        key: 'name-sign-01',
        origin: [0, -wallOffset, signElevation] as const,
        bearingDegrees: 0,
      },
      {
        key: 'name-sign-02',
        origin: [0, wallOffset, signElevation] as const,
        bearingDegrees: 180,
      },
    ] as const;
    const wallOccurrences = [
      {
        key: 'spandrel-wall-01',
        origin: [-halfSpan * 2, -wallOffset, baseElevation] as const,
        bearingDegrees: 0,
      },
      {
        key: 'spandrel-wall-02',
        origin: [halfSpan * 2, wallOffset, baseElevation] as const,
        bearingDegrees: 180,
      },
    ] as const;

    return el('Group', {}, [
      ...fillOccurrences.map(({ key, origin }) => (
        <EarthFill key={key} frame={yawFrame(origin)} {...fillProps} />
      )),
      ...archOccurrences.map(({ key, origin, bearingDegrees }) => (
        <ArchSegment key={key} frame={yawFrame(origin, bearingDegrees)} {...archProps} />
      )),
      ...signOccurrences.map(({ key, origin, bearingDegrees }) => (
        <BridgeNameSign key={key} frame={yawFrame(origin, bearingDegrees)} {...signProps} />
      )),
      ...wallOccurrences.map(({ key, origin, bearingDegrees }) => (
        <SpandrelWall key={key} frame={yawFrame(origin, bearingDegrees)} {...wallProps} />
      )),
    ]);
  },
  { props: railArchSuperstructureProps, semantics }
);
