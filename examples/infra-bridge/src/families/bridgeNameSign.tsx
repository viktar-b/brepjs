/** @jsxImportSource brepjs-families */

import { csg } from 'brepjs';
import { el, family, type EngineeringSemantics } from 'brepjs-families';
import { z } from 'zod';

/** Declared fallback font until CSG IR can embed the public text-to-BRep result. */
export const PROJECT_SIGN_FONT = {
  family: 'Infra Bridge Block',
  glyphWidth: 180,
  glyphHeight: 200,
  stroke: 18,
  advance: 230,
} as const;

const bridgeNameSignProps = z.object({
  text: z.string().trim().min(1),
  width: z.number().positive(),
  height: z.number().positive(),
  plateDepth: z.number().positive(),
  reliefDepth: z.number().positive(),
  material: z.string().trim().min(1),
  name: z.string().trim().min(1).default('Bridge name sign'),
});

export type BridgeNameSignProps = z.output<typeof bridgeNameSignProps>;
export type BridgeNameSignInput = z.input<typeof bridgeNameSignProps>;

type Segment =
  'top' | 'middle' | 'bottom' | 'upper-left' | 'upper-right' | 'lower-left' | 'lower-right';

const GLYPH_SEGMENTS: Readonly<Record<string, readonly Segment[]>> = {
  B: ['top', 'middle', 'bottom', 'upper-left', 'lower-left', 'upper-right', 'lower-right'],
  R: ['top', 'middle', 'upper-left', 'upper-right', 'lower-left', 'lower-right'],
  E: ['top', 'middle', 'bottom', 'upper-left', 'lower-left'],
  P: ['top', 'middle', 'upper-left', 'upper-right', 'lower-left'],
  J: ['top', 'bottom', 'upper-right', 'lower-right', 'lower-left'],
  S: ['top', 'middle', 'bottom', 'upper-left', 'lower-right'],
};

function glyph(text: string, originX: number, originZ: number, depth: number): csg.IRNode {
  const { glyphWidth: width, glyphHeight: height, stroke } = PROJECT_SIGN_FONT;
  const halfHeight = height / 2;
  const separation = 2;
  const middleBase = halfHeight - stroke / 2;
  const lowerVerticalBase = stroke + separation;
  const lowerVerticalHeight = middleBase - separation - lowerVerticalBase;
  const upperVerticalBase = middleBase + stroke + separation;
  const upperVerticalHeight = height - stroke - separation - upperVerticalBase;
  const horizontal = (zOffset: number) =>
    csg.translate(csg.box(width, depth, stroke), [originX, -depth, originZ + zOffset]);
  const vertical = (xOffset: number, zOffset: number, verticalHeight: number) =>
    csg.translate(csg.box(stroke, depth, verticalHeight), [
      originX + xOffset,
      -depth,
      originZ + zOffset,
    ]);
  const builders: Readonly<Record<Segment, () => csg.IRNode>> = {
    top: () => horizontal(height - stroke),
    middle: () => horizontal(halfHeight - stroke / 2),
    bottom: () => horizontal(0),
    'upper-left': () => vertical(0, upperVerticalBase, upperVerticalHeight),
    'upper-right': () => vertical(width - stroke, upperVerticalBase, upperVerticalHeight),
    'lower-left': () => vertical(0, lowerVerticalBase, lowerVerticalHeight),
    'lower-right': () => vertical(width - stroke, lowerVerticalBase, lowerVerticalHeight),
  };
  return csg.compound(
    (GLYPH_SEGMENTS[text] ?? GLYPH_SEGMENTS['E'] ?? []).map((segment) => builders[segment]())
  );
}

function semantics(props: BridgeNameSignProps): EngineeringSemantics {
  return {
    kind: 'sign',
    role: 'marker',
    material: props.material,
    properties: {
      name: props.name,
      length: props.width,
      width: props.plateDepth + props.reliefDepth,
      height: props.height,
      datum: 'lower-centre-back-face',
      text: props.text,
      font: PROJECT_SIGN_FONT.family,
    },
  };
}

/** Framed visible lettering using the project block-font fallback. */
export const BridgeNameSign = family<BridgeNameSignProps, BridgeNameSignInput>(
  'BridgeNameSign',
  ({ text, width, height, plateDepth, reliefDepth }) => {
    const plate = csg.translate(csg.box(width, plateDepth, height), [-width / 2, -plateDepth, 0]);
    const textWidth =
      text.length * PROJECT_SIGN_FONT.advance -
      (PROJECT_SIGN_FONT.advance - PROJECT_SIGN_FONT.glyphWidth);
    const letters = Array.from(text).map((letter, index) =>
      csg.translate(
        glyph(
          letter.toUpperCase(),
          -textWidth / 2 + index * PROJECT_SIGN_FONT.advance,
          (height - PROJECT_SIGN_FONT.glyphHeight) / 2,
          reliefDepth + 1
        ),
        [0, -(plateDepth - 1), 0]
      )
    );
    return el('Geometry', { node: csg.compound([plate, ...letters]) });
  },
  { props: bridgeNameSignProps, semantics }
);
