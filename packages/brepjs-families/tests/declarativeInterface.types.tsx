/** @jsxImportSource brepjs-families */

import {
  assembly,
  civilSemantics,
  el,
  family,
  model,
  type Element,
  type EngineeringSemantics,
} from 'brepjs-families';

interface ChildrenProps {
  readonly children: readonly Element[];
}

interface MemberProps {
  readonly size: number;
  readonly material: 'steel' | 'concrete';
}

const Member = family<MemberProps>(
  'Member',
  ({ size }) => el('Box', { size: [size, size, size] }),
  {
    semantics: ({ material }) => ({ kind: 'structural-member', material }),
  }
);
const MemberAssembly = assembly<ChildrenProps>(
  'MemberAssembly',
  ({ children }) => el('Group', {}, children),
  { semantics: { kind: 'structural-assembly' } }
);
const EngineeringModel = model<ChildrenProps>(
  'EngineeringModel',
  ({ children }) => el('Group', {}, children),
  { semantics: { kind: 'engineering-model' } }
);

const validTree = (
  <EngineeringModel key="model">
    <MemberAssembly key="assembly">
      <Member key="member" size={10} material="steel" />
    </MemberAssembly>
  </EngineeringModel>
);
void validTree;

const Box = 'Box' as const;
const flexibleIntrinsic = <Box size={[10, 20, 30]} kernelSpecificHint="allowed" />;
void flexibleIntrinsic;

// @ts-expect-error Engineering Semantics cannot be patched onto intrinsic JSX elements.
const invalidIntrinsicPatch = <Box semantics={{ kind: 'caller-patch' }} />;
void invalidIntrinsicPatch;

const validSemantics: EngineeringSemantics = { kind: 'structural-member' };
void validSemantics;

const validCivilSemantics = civilSemantics({
  kind: 'spatial-part',
  category: 'bridge-part',
  role: 'superstructure',
  composition: 'element',
  subdivision: 'lateral',
});
void validCivilSemantics;

civilSemantics({
  kind: 'site',
  category: 'bridge-site',
  role: 'civil-context',
  composition: 'partial',
  // @ts-expect-error Site semantics cannot declare Spatial Subdivision.
  subdivision: 'lateral',
});

// @ts-expect-error Product semantics require an authored material.
civilSemantics({
  kind: 'product',
  category: 'beam',
  role: 'main-girder',
  dimensionsMm: { length: 9_891 },
});

// @ts-expect-error Engineering Semantics require a target-independent kind.
const missingKind: EngineeringSemantics = { role: 'primary' };
void missingKind;

const invalidChildren = Member({
  key: 'parent',
  size: 10,
  material: 'steel',
  // @ts-expect-error Member does not declare a children prop.
  children: <Member key="child" size={5} material="steel" />,
});
void invalidChildren;

const invalidPatch = Member({
  key: 'patched-member',
  size: 10,
  material: 'steel',
  // @ts-expect-error Engineering Semantics are definition-owned, not occurrence patches.
  semantics: { kind: 'caller-patch' },
});
void invalidPatch;
