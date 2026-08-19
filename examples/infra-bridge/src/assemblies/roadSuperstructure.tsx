/** @jsxImportSource brepjs-families */

import { assembly, el, type EngineeringSemantics } from 'brepjs-families';
import { z } from 'zod';
import { MainGirder } from '../families/mainGirder.js';
import { yawFrame } from '../frames.js';
import { MATERIALS } from '../materials.js';

const emptyProps = z.object({ label: z.string().optional() });
type EmptyProps = z.output<typeof emptyProps>;
type EmptyInput = z.input<typeof emptyProps>;

const semantics: EngineeringSemantics = {
  kind: 'bridge-part',
  role: 'superstructure',
  properties: { name: 'Road bridge superstructure', usage: 'longitudinal' },
};

/** Three explicit longitudinal girder Occurrences at reviewable transverse set-outs. */
export const RoadSuperstructure = assembly<EmptyProps, EmptyInput>(
  'RoadSuperstructure',
  () =>
    el('Group', {}, [
      <MainGirder
        key="main-girder-01"
        frame={yawFrame([4_945.5, 1_675, -356])}
        length={9_891}
        width={250}
        depth={300}
        material={MATERIALS.bridgeTimber}
        name="Road river bridge - main girder"
      />,
      <MainGirder
        key="main-girder-02"
        frame={yawFrame([4_945.5, 0, -356])}
        length={9_891}
        width={250}
        depth={300}
        material={MATERIALS.bridgeTimber}
        name="Road river bridge - main girder"
      />,
      <MainGirder
        key="main-girder-03"
        frame={yawFrame([4_945.5, -1_675, -356])}
        length={9_891}
        width={250}
        depth={300}
        material={MATERIALS.bridgeTimber}
        name="Road river bridge - main girder"
      />,
    ]),
  { props: emptyProps, semantics }
);
