/** @jsxImportSource brepjs-families */

import { beforeAll, describe, expect, it } from 'vitest';
import { resolve, type ResolvedElement } from 'brepjs-families';
import { RailArchBridge } from '../src/assemblies/railArchBridge.js';
import { RailArchSuperstructure } from '../src/assemblies/railArchSuperstructure.js';
import { RailPier } from '../src/assemblies/railPier.js';
import { RailSite } from '../src/assemblies/railSite.js';
import { RoadAbutment } from '../src/assemblies/roadAbutment.js';
import { RoadGirderBridge } from '../src/assemblies/roadGirderBridge.js';
import { RoadPier } from '../src/assemblies/roadPier.js';
import { RoadSite } from '../src/assemblies/roadSite.js';
import { MATERIALS } from '../src/materials.js';
import { loadProjectFont } from '../src/fonts/projectFont.js';

beforeAll(async () => {
  await import('brepjs/quick');
  await loadProjectFont();
}, 30_000);

describe('owned infrastructure Assemblies', () => {
  it('keeps RoadAbutment as a validated BridgePart definition boundary', () => {
    const root = resolve(
      <RoadAbutment
        key="abutment"
        transverseSide="negative"
        material={MATERIALS.reinforcedConcrete}
      />
    );
    expect(root).toMatchObject({
      type: 'RoadAbutment',
      definitionKind: 'Assembly',
      semantics: { kind: 'bridge-part', role: 'abutment' },
    });
    expect(childKeys(root)).toEqual(['abutment-support-beam']);
    expect(root.children[0]?.semantics).toMatchObject({ kind: 'beam' });
  });

  it('composes RoadPier from the three intended keyed Families', () => {
    const root = resolve(
      <RoadPier
        key="pier"
        concreteMaterial={MATERIALS.reinforcedConcrete}
        stemMaterial={MATERIALS.graniteMasonry}
        girderMaterial={MATERIALS.bridgeTimber}
      />
    );
    expect(root.semantics).toMatchObject({ kind: 'bridge-part', role: 'pier' });
    expect(childKeys(root)).toEqual(['cross-girder', 'pier-stem', 'footing']);
    expect(root.children[0]?.localFrame.origin).toEqual([2_000, -150, -756]);
    expect(root.children[2]?.localFrame.origin).toEqual([0, 0, -3_042.321]);
  });

  it('composes RailPier from one stem and one centred footing', () => {
    const root = resolve(<RailPier key="pier" />);
    expect(root.semantics).toMatchObject({ kind: 'bridge-part', role: 'pier' });
    expect(childKeys(root)).toEqual(['pier-stem', 'footing']);
    expect(root.children[1]?.localFrame).toMatchObject({
      origin: [0, 2_200, 0],
      xAxis: [0, -1, 0],
      zAxis: [0, 0, 1],
    });
  });

  it('makes all ten rail-superstructure products explicit', () => {
    const root = resolve(<RailArchSuperstructure key="superstructure" />);
    expect(root.semantics).toMatchObject({ kind: 'bridge-part', role: 'superstructure' });
    expect(childKeys(root)).toEqual([
      'filler-01',
      'filler-02',
      'arch-segment-01',
      'arch-segment-02',
      'arch-segment-03',
      'arch-segment-04',
      'name-sign-01',
      'name-sign-02',
      'spandrel-wall-01',
      'spandrel-wall-02',
    ]);
  });

  it('reuses one RailArchBridge definition with nested rotated pier Frames', () => {
    const root = resolve(<RailArchBridge key="rail" />);
    expect(childKeys(root)).toEqual(['superstructure', 'substructure']);
    const substructure = root.children[1];
    expect(substructure).toMatchObject({
      type: 'RailSubstructure',
      semantics: { kind: 'bridge-part', role: 'substructure' },
    });
    expect(substructure === undefined ? [] : childKeys(substructure)).toEqual([
      'pier-01',
      'pier-02',
    ]);
    expect(substructure?.children[0]?.worldFrame.origin).toEqual([-2_200, 5_000, -490]);
  });

  it('keeps all five road major BridgeParts explicit', () => {
    const root = resolve(<RoadGirderBridge key="road" />);
    expect(childKeys(root)).toEqual([
      'substructure',
      'superstructure',
      'deck',
      'approach-01',
      'approach-02',
    ]);
  });

  it('owns one road Site definition with the keyed road Bridge', () => {
    const root = resolve(<RoadSite key="road-site" />);
    expect(root).toMatchObject({
      type: 'RoadSite',
      definitionKind: 'Assembly',
      semantics: { kind: 'site', properties: { name: 'Road river bridge site' } },
    });
    expect(childKeys(root)).toEqual(['road-river-bridge']);
  });

  it('reuses one typed rail Site definition with distinct bridge keys', () => {
    const first = resolve(
      <RailSite key="rail-site-01" bridgeKey="rail-bridge-01" siteName="Rail site 01" />
    );
    const second = resolve(
      <RailSite key="rail-site-02" bridgeKey="rail-bridge-02" siteName="Rail site 02" />
    );
    expect(first.type).toBe('RailSite');
    expect(second.type).toBe('RailSite');
    expect(first.semantics?.properties?.['name']).toBe('Rail site 01');
    expect(second.semantics?.properties?.['name']).toBe('Rail site 02');
    expect(childKeys(first)).toEqual(['rail-bridge-01']);
    expect(childKeys(second)).toEqual(['rail-bridge-02']);
  });
});

function childKeys(root: ResolvedElement): readonly string[] {
  return root.children.map(({ keyPath }) => keyPath.slice(keyPath.lastIndexOf('/') + 1));
}
