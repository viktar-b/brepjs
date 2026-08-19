/** @jsxImportSource brepjs-families */

import {
  blueprintToContour,
  csg,
  textBlueprints,
  unwrap,
  type Blueprint,
  type CompoundBlueprint,
} from 'brepjs';
import { el, family, type EngineeringSemantics } from 'brepjs-families';
import { z } from 'zod';
import { PROJECT_SIGN_FONT_FAMILY } from '../fonts/projectFont.js';

/** Metrics for the bundled project OpenType font. */
export const PROJECT_SIGN_FONT = {
  family: PROJECT_SIGN_FONT_FAMILY,
  glyphWidth: 180,
  glyphHeight: 200,
  advance: 230,
} as const;

const bridgeNameSignProps = z
  .object({
    text: z
      .string()
      .trim()
      .min(1)
      .regex(/^[BREPJS]+$/i, 'contains a glyph outside the project block font')
      .transform((value) => value.toUpperCase()),
    width: z.number().positive(),
    height: z.number().positive(),
    plateDepth: z.number().positive(),
    reliefDepth: z.number().positive(),
    material: z.string().trim().min(1),
    name: z.string().trim().min(1).default('Bridge name sign'),
  })
  .superRefine(({ text, width, height }, context) => {
    const textWidth =
      text.length * PROJECT_SIGN_FONT.advance -
      (PROJECT_SIGN_FONT.advance - PROJECT_SIGN_FONT.glyphWidth);
    if (textWidth > width) {
      context.addIssue({ code: 'custom', path: ['text'], message: 'does not fit the sign width' });
    }
    if (PROJECT_SIGN_FONT.glyphHeight > height) {
      context.addIssue({ code: 'custom', path: ['text'], message: 'does not fit the sign height' });
    }
  });

export type BridgeNameSignProps = z.output<typeof bridgeNameSignProps>;
export type BridgeNameSignInput = z.input<typeof bridgeNameSignProps>;

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

/** Backed sign with visible lettering converted from the bundled font to Profile IR. */
export const BridgeNameSign = family<BridgeNameSignProps, BridgeNameSignInput>(
  'BridgeNameSign',
  ({ text, width, height, plateDepth, reliefDepth }) => {
    const plate = csg.translate(csg.box(width, plateDepth, height), [-width / 2, -plateDepth, 0]);
    const textWidth =
      text.length * PROJECT_SIGN_FONT.advance -
      (PROJECT_SIGN_FONT.advance - PROJECT_SIGN_FONT.glyphWidth);
    using outlines = textBlueprints(text, {
      fontFamily: PROJECT_SIGN_FONT.family,
      fontSize: PROJECT_SIGN_FONT.glyphHeight,
    });
    const flatRelief = csg.compound(
      outlines.blueprints.map((blueprint) =>
        csg.extrude(profileFromBlueprint(blueprint), [0, 0, reliefDepth + 1])
      )
    );
    const letters = csg.translate(csg.rotate(flatRelief, 90, { axis: [1, 0, 0] }), [
      -textWidth / 2,
      -(plateDepth - 1),
      (height - PROJECT_SIGN_FONT.glyphHeight) / 2,
    ]);
    return el('Geometry', { node: csg.compound([plate, letters]) });
  },
  { props: bridgeNameSignProps, semantics }
);

function profileFromBlueprint(blueprint: Blueprint | CompoundBlueprint) {
  if ('blueprints' in blueprint) {
    const [outline, ...holes] = blueprint.blueprints;
    if (outline === undefined) throw new Error('Project font produced an empty compound outline');
    return csg.profile(
      unwrap(blueprintToContour(outline)),
      holes.map((hole) => unwrap(blueprintToContour(hole)))
    );
  }
  return csg.profile(unwrap(blueprintToContour(blueprint)));
}
