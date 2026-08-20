import { beforeAll, describe, expect, it } from 'vitest';
import { csg, getBounds, measureVolume, unwrap } from 'brepjs';
import {
  assembly,
  civilSemantics,
  el,
  family,
  frame,
  model,
  normalizeChildren,
  resolve,
  evaluateModel,
  type ElementChild,
  type ResolvedElement,
} from 'brepjs-families';
import {
  BimModel,
  deriveIfcGuidSync,
  disposeImportedModel,
  familiesToBim,
  fromIfc,
  hasErrors,
  toIfc,
  toIfcValidated,
  type ImportedSpatialNode,
} from '../src/index.js';
import { initOCCT } from '../../../tests/setup.js';

const PROJECT_ID = 'gate-2a-synthetic-infrastructure';
const guidOf = (keyPath: string): string => deriveIfcGuidSync(`elem:${PROJECT_ID}:${keyPath}`);

interface ChildrenProps {
  readonly children?: ElementChild;
}

interface MemberProps {
  readonly name: string;
  readonly length: number;
  readonly width: number;
  readonly height: number;
  readonly material: string;
}

interface BoxProductProps extends MemberProps {
  readonly role: string;
}

interface ReusedCivilProductProps extends BoxProductProps {
  readonly kind: 'beam' | 'column' | 'slab' | 'wall' | 'footing' | 'railing';
}

type RectangularPrismDatum = 'profile-centered-yz' | 'profile-centered-xy' | 'corner-xyz';

function rectangularPrismDatum(kind: ReusedCivilProductProps['kind']): RectangularPrismDatum {
  if (kind === 'beam') return 'profile-centered-yz';
  if (kind === 'column') return 'profile-centered-xy';
  return 'corner-xyz';
}

// The definition display names are deliberately unrelated to their engineering
// kinds. Projection must route from resolved semantics, never these names.
const RootComposition = model<ChildrenProps>(
  'RootComposition',
  (props) => el('Group', {}, normalizeChildren(props.children)),
  { semantics: { kind: 'project' } }
);

const PlaceComposition = assembly<ChildrenProps>(
  'PlaceComposition',
  (props) => el('Group', {}, normalizeChildren(props.children)),
  { semantics: { kind: 'site', properties: { name: 'Synthetic Site' } } }
);

const CrossingComposition = assembly<ChildrenProps>(
  'CrossingComposition',
  (props) => el('Group', {}, normalizeChildren(props.children)),
  {
    semantics: {
      kind: 'bridge',
      role: 'girder',
      properties: { name: 'Synthetic Bridge' },
    },
  }
);

const SpanComposition = assembly<ChildrenProps>(
  'SpanComposition',
  (props) => el('Group', {}, normalizeChildren(props.children)),
  {
    semantics: {
      kind: 'bridge-part',
      role: 'superstructure',
      properties: { name: 'Synthetic Superstructure' },
    },
  }
);

const LinearBody = family<MemberProps>(
  'LinearBody',
  ({ length, width, height }) =>
    el('Geometry', {
      node: csg.translate(csg.box(length, width, height), [0, -width / 2, -height / 2]),
    }),
  {
    semantics: ({ name, length, width, height, material }) => ({
      kind: 'member',
      role: 'longitudinal',
      material,
      properties: {
        name,
        length,
        width,
        height,
        geometryForm: 'rectangular-prism',
        geometryDatum: 'profile-centered-yz',
      },
    }),
  }
);

const MateriallessBody = family<Omit<MemberProps, 'material'>>(
  'MateriallessBody',
  ({ length, width, height }) =>
    el('Geometry', {
      node: csg.translate(csg.box(length, width, height), [0, -width / 2, -height / 2]),
    }),
  {
    semantics: ({ name, length, width, height }) => ({
      kind: 'member',
      role: 'longitudinal',
      properties: { name, length, width, height, geometryForm: 'rectangular-prism' },
    }),
  }
);

const DatumlessBody = family<MemberProps>(
  'DatumlessBody',
  ({ length, width, height }) =>
    el('Geometry', {
      node: csg.translate(csg.box(length, width, height), [0, -width / 2, -height / 2]),
    }),
  {
    semantics: ({ name, length, width, height, material }) => ({
      kind: 'member',
      role: 'longitudinal',
      material,
      properties: { name, length, width, height, geometryForm: 'rectangular-prism' },
    }),
  }
);

const SignBody = family<BoxProductProps>(
  'SignBody',
  ({ length, width, height }) =>
    el('Geometry', {
      node: csg.translate(csg.box(length, width, height), [0, -width / 2, -height / 2]),
    }),
  {
    semantics: ({ name, length, width, height, material, role }) => ({
      kind: 'sign',
      role,
      material,
      properties: {
        name,
        length,
        width,
        height,
        geometryForm: 'rectangular-prism',
        geometryDatum: 'profile-centered-yz',
      },
    }),
  }
);

const EarthworksBody = family<BoxProductProps>(
  'EarthworksBody',
  ({ length, width, height }) =>
    el('Geometry', {
      node: csg.translate(csg.box(length, width, height), [0, -width / 2, -height / 2]),
    }),
  {
    semantics: ({ name, length, width, height, material, role }) => ({
      kind: 'earthworks-fill',
      role,
      material,
      properties: {
        name,
        length,
        width,
        height,
        geometryForm: 'rectangular-prism',
        geometryDatum: 'profile-centered-yz',
      },
    }),
  }
);

const ReusedCivilBody = family<ReusedCivilProductProps>(
  'ReusedCivilBody',
  ({ kind, length, width, height }) =>
    el('Geometry', {
      node:
        kind === 'beam'
          ? csg.translate(csg.box(length, width, height), [0, -width / 2, -height / 2])
          : kind === 'column'
            ? csg.translate(csg.box(length, width, height), [-length / 2, -width / 2, 0])
            : csg.box(length, width, height),
    }),
  {
    semantics: ({ kind, role, name, length, width, height, material }) => ({
      kind,
      role,
      material,
      properties: {
        name,
        length,
        width,
        height,
        geometryForm: 'rectangular-prism',
        geometryDatum: rectangularPrismDatum(kind),
      },
    }),
  }
);

const EvaluatedMemberBody = family<{ readonly name: string; readonly material: string }>(
  'EvaluatedMemberBody',
  () => el('Geometry', { node: csg.fuse(csg.box(800, 120, 160), csg.box(160, 500, 160)) }),
  {
    semantics: ({ name, material }) => ({
      kind: 'member',
      role: 'brace',
      material,
      // Envelope dimensions alone do not license a rectangular analytic substitute.
      properties: { name, length: 800, width: 500, height: 160 },
    }),
  }
);

const EvaluatedBeamBody = family<{ readonly name: string; readonly material: string }>(
  'EvaluatedBeamBody',
  () => el('Geometry', { node: csg.fuse(csg.box(700, 100, 140), csg.box(120, 420, 140)) }),
  {
    semantics: ({ name, material }) => ({
      kind: 'beam',
      role: 'cross-girder',
      material,
      properties: { name, length: 700, width: 420, height: 140 },
    }),
  }
);

const projectFrame = frame({
  origin: [1_000, 2_000, 100],
  xAxis: [1, 0, 0],
  zAxis: [0, 0, 1],
});

function buildSyntheticInfrastructure() {
  return RootComposition({
    key: 'infrastructure',
    frame: projectFrame,
    children: PlaceComposition({
      key: 'site',
      frame: frame({ origin: [100, 0, 0], xAxis: [1, 0, 0], zAxis: [0, 0, 1] }),
      children: CrossingComposition({
        key: 'bridge',
        frame: frame({ origin: [0, 200, 0], xAxis: [0, 1, 0], zAxis: [0, 0, 1] }),
        children: SpanComposition({
          key: 'superstructure',
          frame: frame({ origin: [50, 0, 20], xAxis: [1, 0, 0], zAxis: [0, 0, 1] }),
          children: LinearBody({
            key: 'girder-01',
            frame: frame({ origin: [25, 10, 5], xAxis: [1, 0, 0], zAxis: [0, 0, 1] }),
            name: 'Longitudinal Girder 01',
            length: 1_000,
            width: 100,
            height: 200,
            material: 'Structural Steel',
          }),
        }),
      }),
    }),
  });
}

function buildAllCivilProducts() {
  return RootComposition({
    key: 'all-civil-products',
    children: PlaceComposition({
      key: 'site',
      children: CrossingComposition({
        key: 'bridge',
        children: SpanComposition({
          key: 'part',
          children: [
            LinearBody({
              key: 'member',
              name: 'Synthetic Member',
              length: 1_000,
              width: 100,
              height: 200,
              material: 'Structural Steel',
            }),
            SignBody({
              key: 'sign',
              name: 'Bridge Sign',
              role: 'pictorial',
              length: 40,
              width: 1_200,
              height: 600,
              material: 'Aluminium',
            }),
            EarthworksBody({
              key: 'backfill',
              name: 'Abutment Backfill',
              role: 'backfill',
              length: 2_000,
              width: 3_000,
              height: 1_500,
              material: 'Compacted Fill',
            }),
            ...(
              [
                ['beam', 'cross-girder', 'Cross Girder', 900, 140, 240, 'Steel'],
                ['column', 'pier-stem', 'Pier Stem', 600, 450, 2_400, 'Concrete'],
                ['slab', 'deck', 'Bridge Deck', 1_500, 900, 180, 'Concrete'],
                ['wall', 'abutment', 'Abutment Wall', 1_200, 250, 1_100, 'Concrete'],
                ['footing', 'pad', 'Pier Footing', 1_400, 1_100, 300, 'Concrete'],
                ['railing', 'guardrail', 'Bridge Guardrail', 1_500, 80, 1_000, 'Steel'],
              ] as const
            ).map(([kind, role, name, length, width, height, material]) =>
              ReusedCivilBody({
                key: kind,
                kind,
                role,
                name,
                length,
                width,
                height,
                material,
              })
            ),
          ],
        }),
      }),
    }),
  });
}

function buildEvaluatedProductBody() {
  return RootComposition({
    key: 'evaluated-product-body',
    children: PlaceComposition({
      key: 'site',
      children: CrossingComposition({
        key: 'bridge',
        children: SpanComposition({
          key: 'part',
          children: [
            EvaluatedMemberBody({
              key: 'curved-member',
              name: 'Evaluated Brace',
              material: 'Steel',
              frame: frame({
                origin: [250, 500, 750],
                xAxis: [0, 1, 0],
                zAxis: [0, 0, 1],
              }),
            }),
            EvaluatedBeamBody({
              key: 'cross-girder',
              name: 'Evaluated Cross Girder',
              material: 'Steel',
            }),
          ],
        }),
      }),
    }),
  });
}

function flattenSpatial(root: ImportedSpatialNode | null): ImportedSpatialNode[] {
  if (root === null) return [];
  return [root, ...root.children.flatMap((child) => flattenSpatial(child))];
}

beforeAll(async () => {
  await initOCCT();
}, 30_000);

describe('families infrastructure projection', () => {
  it('requires an explicit matching Datum before selecting analytic Product Body geometry', () => {
    const resolved = resolve(
      RootComposition({
        key: 'datum-proof',
        children: PlaceComposition({
          key: 'site',
          children: CrossingComposition({
            key: 'bridge',
            children: SpanComposition({
              key: 'part',
              children: DatumlessBody({
                key: 'member',
                name: 'Unproven Datum',
                length: 1_000,
                width: 100,
                height: 200,
                material: 'Steel',
              }),
            }),
          }),
        }),
      })
    );

    expect(
      familiesToBim(resolved, {
        project: { name: 'Datum proof', projectId: 'gate-2-datum-proof' },
      })
    ).toMatchObject({
      ok: false,
      error: { code: 'FAMILIES_INVALID_SEMANTIC_PROPERTY' },
    });
  });

  it('uses evaluated authored tessellation as a typed Product Body fallback', async () => {
    const resolved = resolve(buildEvaluatedProductBody());
    using evaluator = new csg.Evaluator();
    const evaluatedModel = evaluateModel(resolved, evaluator);
    const projected = unwrap(
      familiesToBim(resolved, {
        project: { name: 'Evaluated Product Body', projectId: 'gate-2-product-body' },
        evaluatedModel,
      })
    );
    using bim = projected.model;

    expect(bim.getMembers()[0]?.productBody?.kind).toBe('TESSELLATED');
    expect(bim.getMembers()[0]?.geometry).toBeNull();
    expect(bim.getBeams()[0]?.productBody?.kind).toBe('TESSELLATED');
    expect(bim.getBeams()[0]?.geometry).toBeNull();
    expect(bim.getProxies()).toHaveLength(0);
    const bytes = unwrap(
      await toIfc(bim, {
        applicationName: 'brepjs Gate 2',
        applicationVersion: '1',
        ifcSchema: 'IFC4X3',
      })
    );
    const step = new TextDecoder().decode(bytes).toUpperCase();
    expect(step).toContain('IFCMEMBER(');
    expect(step).toContain('IFCBEAM(');
    expect(step).toContain('IFCTRIANGULATEDFACESET(');
    expect(step).not.toContain('IFCBUILDINGELEMENTPROXY(');

    const imported = unwrap(await fromIfc(bytes));
    try {
      const member = imported.elements.find((element) => element.category === 'MEMBER');
      expect(member?.geometry.fidelity).toBe('TESSELLATED_LOSSY');
      expect(member?.material?.name).toBe('Steel');
    } finally {
      disposeImportedModel(imported);
    }
  });

  it('projects every required civil product through typed IFC4X3 entities', async () => {
    const projected = unwrap(
      familiesToBim(resolve(buildAllCivilProducts()), {
        project: { name: 'All Civil Products', projectId: 'gate-2-all-civil-products' },
      })
    );
    using bim = projected.model;

    expect(bim.getMembers()).toHaveLength(1);
    expect(bim.getSigns()).toHaveLength(1);
    expect(bim.getEarthworksFills()).toHaveLength(1);
    expect(bim.getBeams()).toHaveLength(1);
    expect(bim.getColumns()).toHaveLength(1);
    expect(bim.getSlabs()).toHaveLength(1);
    expect(bim.getWalls()).toHaveLength(1);
    expect(bim.getFootings()).toHaveLength(1);
    expect(bim.getRailings()).toHaveLength(1);
    expect(bim.getProxies()).toHaveLength(0);

    const validated = unwrap(
      await toIfcValidated(bim, {
        applicationName: 'brepjs Gate 2',
        applicationVersion: '1',
        ifcSchema: 'IFC4X3',
      })
    );
    expect(hasErrors(validated.report), validated.report.issues).toBe(false);
    const step = new TextDecoder().decode(validated.bytes).toUpperCase();
    expect(step).toContain('IFCMEMBER(');
    expect(step).toContain('IFCSIGN(');
    expect(step).toContain('IFCEARTHWORKSFILL(');
    expect(step).toContain('IFCBEAM(');
    expect(step).toContain('IFCCOLUMN(');
    expect(step).toContain('IFCSLAB(');
    expect(step).toContain('IFCWALL(');
    expect(step).toContain('IFCFOOTING(');
    expect(step).toContain('IFCRAILING(');
    expect(step).not.toContain('IFCBUILDINGELEMENTPROXY(');

    const imported = unwrap(await fromIfc(validated.bytes));
    try {
      expect(imported.elements.map((element) => element.category)).toEqual(
        expect.arrayContaining([
          'MEMBER',
          'SIGN',
          'EARTHWORKS_FILL',
          'BEAM',
          'COLUMN',
          'SLAB',
          'WALL',
          'FOOTING',
          'RAILING',
        ])
      );
      expect(imported.elements.find((element) => element.category === 'SIGN')?.material?.name).toBe(
        'Aluminium'
      );
      expect(
        imported.elements.find((element) => element.category === 'EARTHWORKS_FILL')?.material?.name
      ).toBe('Compacted Fill');
      const expectedBounds = [
        ['MEMBER', [0, 1_000, -50, 50, -100, 100]],
        ['SIGN', [0, 40, -600, 600, -300, 300]],
        ['EARTHWORKS_FILL', [0, 2_000, -1_500, 1_500, -750, 750]],
        ['BEAM', [0, 900, -70, 70, -120, 120]],
        ['COLUMN', [-300, 300, -225, 225, 0, 2_400]],
        ['SLAB', [0, 1_500, 0, 900, 0, 180]],
        ['WALL', [0, 1_200, 0, 250, 0, 1_100]],
        ['FOOTING', [0, 1_400, 0, 1_100, 0, 300]],
        ['RAILING', [0, 1_500, 0, 80, 0, 1_000]],
      ] as const;
      for (const [category, expected] of expectedBounds) {
        const solid = imported.elements.find((element) => element.category === category)?.geometry
          .solid;
        expect(solid, category).not.toBeNull();
        if (solid === null || solid === undefined) continue;
        const bounds = getBounds(solid);
        const actual = [
          bounds.xMin,
          bounds.xMax,
          bounds.yMin,
          bounds.yMax,
          bounds.zMin,
          bounds.zMax,
        ];
        for (let index = 0; index < expected.length; index++) {
          expect(actual[index], `${category} bound ${index}`).toBeCloseTo(expected[index] ?? 0, 2);
        }
        expect(unwrap(measureVolume(solid)), category).toBeCloseTo(
          (expected[1] - expected[0]) * (expected[3] - expected[2]) * (expected[5] - expected[4]),
          -1
        );
      }
    } finally {
      disposeImportedModel(imported);
    }
  });

  it('projects Project → Site → Bridge → BridgePart → Member through the public seam', async () => {
    const projected = unwrap(
      familiesToBim(resolve(buildSyntheticInfrastructure()), {
        project: { name: 'Gate 2A Infrastructure', projectId: PROJECT_ID },
      })
    );
    using bim = projected.model;

    expect(bim.getBridges()).toHaveLength(1);
    expect(bim.getBridgeParts()).toHaveLength(1);
    expect(bim.getMembers()).toHaveLength(1);
    expect(bim.getBuildings()).toHaveLength(0);
    expect(bim.getStoreys()).toHaveLength(0);
    expect(bim.getProxies()).toHaveLength(0);
    expect(bim.getSites()[0]?.spec.origin).toEqual([1_100, 2_000, 100]);
    expect(bim.getBridges()[0]?.spec).toMatchObject({
      origin: [0, 200, 0],
      axisX: [0, 1, 0],
      predefinedType: 'GIRDER',
    });
    expect(bim.getBridgeParts()[0]?.spec).toMatchObject({
      origin: [50, 0, 20],
      predefinedType: 'SUPERSTRUCTURE',
    });
    expect(bim.getMembers()[0]?.spec).toMatchObject({
      origin: [25, 10, 5],
      predefinedType: 'STRINGER',
      materialName: 'Structural Steel',
    });

    const paths = {
      project: 'infrastructure',
      site: 'infrastructure/site',
      bridge: 'infrastructure/site/bridge',
      part: 'infrastructure/site/bridge/superstructure',
      member: 'infrastructure/site/bridge/superstructure/girder-01',
    } as const;
    for (const path of Object.values(paths)) {
      const localId = projected.idByKeyPath.get(path);
      expect(localId, path).toBeDefined();
      const element = bim.getAllElements().find((candidate) => candidate.localId === localId);
      expect(element?.guid, path).toBe(guidOf(path));
    }

    const id = (path: string) => {
      const value = projected.idByKeyPath.get(path);
      if (value === undefined) throw new Error(`missing projected id for ${path}`);
      return value;
    };
    const relationships = bim.getAllRelationships();
    expect(relationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'AGGREGATES',
          relatingObject: id(paths.project),
          relatedObjects: [id(paths.site)],
        }),
        expect.objectContaining({
          kind: 'AGGREGATES',
          relatingObject: id(paths.site),
          relatedObjects: [id(paths.bridge)],
        }),
        expect.objectContaining({
          kind: 'AGGREGATES',
          relatingObject: id(paths.bridge),
          relatedObjects: [id(paths.part)],
        }),
        expect.objectContaining({
          kind: 'CONTAINED_IN',
          relatingStructure: id(paths.part),
          relatedElements: [id(paths.member)],
        }),
        expect.objectContaining({
          kind: 'ASSOCIATES_MATERIAL',
          relatedObjects: [id(paths.member)],
        }),
      ])
    );

    const validated = unwrap(
      await toIfcValidated(bim, {
        applicationName: 'brepjs Gate 2A',
        applicationVersion: '1',
        ifcSchema: 'IFC4X3',
      })
    );
    expect(hasErrors(validated.report), validated.report.issues).toBe(false);

    const step = new TextDecoder().decode(validated.bytes).toUpperCase();
    expect(step).toContain('IFCBRIDGE(');
    expect(step).toContain('IFCBRIDGEPART(');
    expect(step).toContain('IFCMEMBER(');
    expect(step).not.toContain('IFCBUILDING(');
    expect(step).not.toContain('IFCBUILDINGSTOREY(');
    expect(step).not.toContain('IFCBUILDINGELEMENTPROXY(');

    const imported = unwrap(await fromIfc(validated.bytes));
    try {
      expect(imported.schema).toBe('IFC4X3');
      const spatial = flattenSpatial(imported.spatialTree);
      expect(spatial.map((node) => node.category)).toEqual([
        'PROJECT',
        'SITE',
        'BRIDGE',
        'BRIDGE_PART',
      ]);

      const importedMember = imported.elements.find(
        (element) => element.guid === guidOf(paths.member)
      );
      expect(importedMember?.category).toBe('MEMBER');
      expect(importedMember?.material?.name).toBe('Structural Steel');
      const importedPart = spatial.find((node) => node.category === 'BRIDGE_PART');
      expect(importedMember?.spatialContainerExpressId).toBe(importedPart?.expressId);
      expect(importedPart?.containedElements).toContain(importedMember?.expressId);

      expect(importedMember?.geometry.solid).not.toBeNull();
      if (importedMember?.geometry.solid) {
        expect(unwrap(measureVolume(importedMember.geometry.solid))).toBeCloseTo(20_000_000, -1);
        const bounds = getBounds(importedMember.geometry.solid);
        expect(bounds.xMin).toBeCloseTo(1_040, 2);
        expect(bounds.xMax).toBeCloseTo(1_140, 2);
        expect(bounds.yMin).toBeCloseTo(2_275, 2);
        expect(bounds.yMax).toBeCloseTo(3_275, 2);
        expect(bounds.zMin).toBeCloseTo(25, 2);
        expect(bounds.zMax).toBeCloseTo(225, 2);
      }
    } finally {
      disposeImportedModel(imported);
    }
  });

  it('preserves recursive Spatial Assemblies and nearest product containment', () => {
    const TypedBeam = family<MemberProps>(
      'TypedBeam',
      ({ length, width, height }) =>
        el('Geometry', {
          node: csg.translate(csg.box(length, width, height), [0, -width / 2, -height / 2]),
        }),
      {
        semantics: ({ name, length, width, height, material }) =>
          civilSemantics({
            kind: 'product',
            category: 'beam',
            role: 'main-girder',
            material,
            dimensionsMm: { length, width, height },
            properties: {
              name,
              geometryForm: 'rectangular-prism',
              geometryDatum: 'profile-centered-yz',
            },
          }),
      }
    );
    const NestedPart = assembly<ChildrenProps>(
      'NestedPart',
      (props) => el('Group', {}, normalizeChildren(props.children)),
      {
        semantics: civilSemantics({
          kind: 'spatial-part',
          category: 'bridge-part',
          role: 'deck',
          composition: 'element',
          subdivision: 'lateral',
        }),
      }
    );
    const ParentPart = assembly<ChildrenProps>(
      'ParentPart',
      (props) => el('Group', {}, normalizeChildren(props.children)),
      {
        semantics: civilSemantics({
          kind: 'spatial-part',
          category: 'bridge-part',
          role: 'superstructure',
          composition: 'collection',
          subdivision: 'lateral',
        }),
      }
    );
    const TypedBridge = assembly<ChildrenProps>(
      'TypedBridge',
      (props) => el('Group', {}, normalizeChildren(props.children)),
      {
        semantics: civilSemantics({
          kind: 'facility',
          category: 'bridge',
          role: 'girder',
          composition: 'element',
        }),
      }
    );
    const NestedSite = assembly<ChildrenProps>(
      'NestedSite',
      (props) => el('Group', {}, normalizeChildren(props.children)),
      {
        semantics: civilSemantics({
          kind: 'site',
          category: 'bridge-site',
          role: 'bridge-context',
          composition: 'partial',
        }),
      }
    );
    const EnvironmentSite = assembly<ChildrenProps>(
      'EnvironmentSite',
      (props) => el('Group', {}, normalizeChildren(props.children)),
      {
        semantics: civilSemantics({
          kind: 'site',
          category: 'environment',
          role: 'civil-context',
          composition: 'collection',
        }),
      }
    );
    const resolved = resolve(
      el(
        RootComposition,
        { key: 'recursive-model' },
        el(
          EnvironmentSite,
          {
            key: 'environment-site',
            frame: frame({ origin: [100, 200, 0], xAxis: [1, 0, 0], zAxis: [0, 0, 1] }),
          },
          el(
            NestedSite,
            {
              key: 'bridge-site',
              frame: frame({ origin: [10, 20, 0], xAxis: [0, 1, 0], zAxis: [0, 0, 1] }),
            },
            el(
              TypedBridge,
              {
                key: 'bridge',
                frame: frame({ origin: [5, 0, 0], xAxis: [1, 0, 0], zAxis: [0, 0, 1] }),
              },
              el(
                ParentPart,
                {
                  key: 'superstructure',
                  frame: frame({
                    origin: [0, 3, 0],
                    xAxis: [1, 0, 0],
                    zAxis: [0, 0, 1],
                  }),
                },
                el(
                  NestedPart,
                  {
                    key: 'deck',
                    frame: frame({
                      origin: [0, 0, 2],
                      xAxis: [1, 0, 0],
                      zAxis: [0, 0, 1],
                    }),
                  },
                  el(TypedBeam, {
                    key: 'main-girder',
                    frame: frame({
                      origin: [1, 1, 1],
                      xAxis: [1, 0, 0],
                      zAxis: [0, 0, 1],
                    }),
                    name: 'Main girder',
                    length: 1_000,
                    width: 100,
                    height: 200,
                    material: 'Timber',
                  })
                )
              )
            )
          )
        )
      )
    );

    const projected = unwrap(
      familiesToBim(resolved, {
        project: { name: 'Recursive civil hierarchy', projectId: 'recursive-civil-hierarchy' },
      })
    );
    using bim = projected.model;
    const [environment, bridgeSite] = bim.getSites();
    const [bridge] = bim.getBridges();
    const [superstructure, deck] = bim.getBridgeParts();
    const [girder] = bim.getBeams();

    expect(environment?.spec.origin).toEqual([100, 200, 0]);
    expect(bridgeSite?.spec.origin).toEqual([10, 20, 0]);
    expect(bridge?.spec.origin).toEqual([5, 0, 0]);
    expect(superstructure?.spec.origin).toEqual([0, 3, 0]);
    expect(deck?.spec.origin).toEqual([0, 0, 2]);
    expect(girder?.spec.origin).toEqual([1, 1, 1]);

    const id = (path: string) => {
      const value = projected.idByKeyPath.get(path);
      if (value === undefined) throw new Error(`missing projected id for ${path}`);
      return value;
    };
    const paths = {
      project: 'recursive-model',
      environment: 'recursive-model/environment-site',
      site: 'recursive-model/environment-site/bridge-site',
      bridge: 'recursive-model/environment-site/bridge-site/bridge',
      superstructure: 'recursive-model/environment-site/bridge-site/bridge/superstructure',
      deck: 'recursive-model/environment-site/bridge-site/bridge/superstructure/deck',
      girder: 'recursive-model/environment-site/bridge-site/bridge/superstructure/deck/main-girder',
    } as const;
    const recursiveRelationships = bim.getAllRelationships();
    expect(recursiveRelationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'AGGREGATES',
          relatingObject: id(paths.project),
          relatedObjects: [id(paths.environment)],
        }),
        expect.objectContaining({
          kind: 'AGGREGATES',
          relatingObject: id(paths.environment),
          relatedObjects: [id(paths.site)],
        }),
        expect.objectContaining({
          kind: 'AGGREGATES',
          relatingObject: id(paths.superstructure),
          relatedObjects: [id(paths.deck)],
        }),
        expect.objectContaining({
          kind: 'CONTAINED_IN',
          relatingStructure: id(paths.deck),
          relatedElements: [id(paths.girder)],
        }),
      ])
    );
    expect(
      recursiveRelationships.filter(
        (relationship) =>
          relationship.kind === 'CONTAINED_IN' &&
          relationship.relatedElements.includes(id(paths.girder))
      )
    ).toEqual([
      expect.objectContaining({
        kind: 'CONTAINED_IN',
        relatingStructure: id(paths.deck),
        relatedElements: [id(paths.girder)],
      }),
    ]);
  });

  it('rejects a recursive civil ownership cycle with the offending key path', () => {
    const source = resolve(buildSyntheticInfrastructure());
    const sourceSite = source.children[0];
    expect(sourceSite).toBeDefined();
    if (sourceSite === undefined) return;

    const cyclingSite = { ...sourceSite, children: [] as ResolvedElement[] };
    cyclingSite.children.push(cyclingSite);
    const cyclicRoot = { ...source, children: [cyclingSite] };

    const result = familiesToBim(cyclicRoot, {
      project: { name: 'Cyclic civil hierarchy', projectId: 'cyclic-civil-hierarchy' },
    });
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'FAMILIES_CIVIL_HIERARCHY_CYCLE',
      },
    });
    if (!result.ok) {
      expect(result.error.message).toContain(cyclingSite.keyPath);
    }
  });

  it('rejects one resolved civil element owned by two Spatial Assemblies', () => {
    const source = resolve(buildSyntheticInfrastructure());
    const sourceSite = source.children[0];
    const sourceBridge = sourceSite?.children[0];
    expect(sourceSite).toBeDefined();
    expect(sourceBridge).toBeDefined();
    if (sourceSite === undefined || sourceBridge === undefined) return;

    const alternateSite = {
      ...sourceSite,
      keyPath: `${source.keyPath}/alternate-site`,
      children: [sourceBridge],
    };
    const result = familiesToBim(
      { ...source, children: [sourceSite, alternateSite] },
      { project: { name: 'Duplicate civil owner', projectId: 'duplicate-civil-owner' } }
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'FAMILIES_DUPLICATE_CIVIL_PARENT' },
    });
    if (!result.ok) {
      expect(result.error.message).toContain(sourceBridge.keyPath);
      expect(result.error.message).toContain(sourceSite.keyPath);
      expect(result.error.message).toContain(alternateSite.keyPath);
    }
  });

  it('rejects physical products as civil ownership parents', () => {
    const source = resolve(buildSyntheticInfrastructure());
    const sourceSite = source.children[0];
    const sourceBridge = sourceSite?.children[0];
    const sourcePart = sourceBridge?.children[0];
    const sourceProduct = sourcePart?.children[0];
    expect(sourceProduct).toBeDefined();
    if (
      sourceSite === undefined ||
      sourceBridge === undefined ||
      sourcePart === undefined ||
      sourceProduct === undefined
    ) {
      return;
    }

    const childProduct = {
      ...sourceProduct,
      keyPath: `${sourceProduct.keyPath}/child-product`,
    };
    const productParent = { ...sourceProduct, children: [childProduct] };
    const result = familiesToBim(
      {
        ...source,
        children: [
          {
            ...sourceSite,
            children: [
              {
                ...sourceBridge,
                children: [{ ...sourcePart, children: [productParent] }],
              },
            ],
          },
        ],
      },
      { project: { name: 'Product parent', projectId: 'product-parent' } }
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'FAMILIES_PRODUCT_PARENT' } });
    if (!result.ok) {
      expect(result.error.message).toContain(sourceProduct.keyPath);
      expect(result.error.message).toContain(childProduct.keyPath);
    }
  });

  it('rejects invalid civil roots and invalid parent kinds with key-path-aware errors', () => {
    const source = resolve(buildSyntheticInfrastructure());
    const sourceSite = source.children[0];
    const sourceBridge = sourceSite?.children[0];
    expect(sourceBridge).toBeDefined();
    if (sourceBridge === undefined) return;

    const invalidRoot = familiesToBim(
      {
        ...source,
        semantics: civilSemantics({
          kind: 'site',
          category: 'bridge-site',
          role: 'bridge-context',
          composition: 'partial',
        }),
      },
      { project: { name: 'Invalid root', projectId: 'invalid-root' } }
    );
    expect(invalidRoot).toMatchObject({
      ok: false,
      error: { code: 'FAMILIES_CIVIL_ROOT_KIND' },
    });
    if (!invalidRoot.ok) expect(invalidRoot.error.message).toContain(source.keyPath);

    const invalidParent = familiesToBim(
      { ...source, children: [sourceBridge] },
      { project: { name: 'Invalid parent', projectId: 'invalid-parent' } }
    );
    expect(invalidParent).toMatchObject({
      ok: false,
      error: { code: 'FAMILIES_INVALID_CIVIL_HIERARCHY' },
    });
    if (!invalidParent.ok) expect(invalidParent.error.message).toContain(sourceBridge.keyPath);
  });

  it('returns a structured BimError when the civil model targets IFC4', async () => {
    const projected = unwrap(
      familiesToBim(resolve(buildSyntheticInfrastructure()), {
        project: { name: 'Gate 2A Infrastructure', projectId: PROJECT_ID },
      })
    );
    using bim = projected.model;
    const result = await toIfc(bim, {
      applicationName: 'brepjs Gate 2A',
      applicationVersion: '1',
      ifcSchema: 'IFC4',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({ kind: 'BIM_IFC', code: 'IFC4X3_REQUIRED' });
    }
  });

  it('serializes a Member-only BimModel as IFC4', async () => {
    using bim = new BimModel();
    const projectId = unwrap(bim.init({ name: 'IFC4 Member Project' }));
    const siteId = unwrap(bim.addSite({ name: 'IFC4 Member Site' }));
    bim.aggregate(projectId, siteId);
    const memberId = unwrap(
      bim.addMember({
        name: 'IFC4 Member',
        length: 1_000,
        profile: { kind: 'RECTANGULAR', width: 100, height: 200 },
        origin: [0, 0, 0],
        axisX: [1, 0, 0],
        axisZ: [0, 0, 1],
        predefinedType: 'MEMBER',
        materialName: 'Structural Steel',
      })
    );
    bim.placeIn(memberId, siteId);

    const result = await toIfc(bim, {
      applicationName: 'brepjs Gate 2A repair',
      applicationVersion: '1',
      ifcSchema: 'IFC4',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(new TextDecoder().decode(result.value).toUpperCase()).toContain('IFCMEMBER(');
    }
  });

  it('rejects an open direct Product Body through a structured BimError', () => {
    using bim = new BimModel();
    unwrap(bim.init({ name: 'Invalid Product Body' }));
    const result = bim.addMember(
      {
        name: 'Invalid Member',
        length: 10,
        profile: { kind: 'RECTANGULAR', width: 10, height: 10 },
        origin: [0, 0, 0],
        axisX: [1, 0, 0],
        axisZ: [0, 0, 1],
        materialName: 'Steel',
      },
      {
        productBody: {
          kind: 'TESSELLATED',
          mesh: {
            vertices: new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]),
            triangles: new Uint32Array([0, 1, 2]),
            normals: new Float32Array(9),
            uvs: new Float32Array(),
            faceGroups: [],
          },
        },
      }
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_PRODUCT_BODY' } });
  });

  it.each([
    [
      'same-winding edge incidence',
      new Uint32Array([
        0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3,
        4, 0, 3, 4, 7,
      ]),
    ],
    [
      'zero-area triangle',
      new Uint32Array([
        0, 0, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3,
        0, 4, 3, 4, 7,
      ]),
    ],
  ])('rejects a direct Product Body with %s', (_case, triangles) => {
    using bim = new BimModel();
    unwrap(bim.init({ name: 'Invalid Product Body' }));
    const result = bim.addMember(
      {
        name: 'Invalid Member',
        length: 10,
        profile: { kind: 'RECTANGULAR', width: 10, height: 10 },
        origin: [0, 0, 0],
        axisX: [1, 0, 0],
        axisZ: [0, 0, 1],
        materialName: 'Steel',
      },
      {
        productBody: {
          kind: 'TESSELLATED',
          mesh: {
            vertices: new Float32Array([
              0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0, 0, 0, 10, 10, 0, 10, 10, 10, 10, 0, 10, 10,
            ]),
            triangles,
            normals: new Float32Array(24),
            uvs: new Float32Array(),
            faceGroups: [],
          },
        },
      }
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_PRODUCT_BODY' } });
  });

  it('returns FAMILIES_INVALID_CIVIL_HIERARCHY for a Member directly under a Site', () => {
    const resolved = resolve(
      RootComposition({
        key: 'invalid-hierarchy',
        children: PlaceComposition({
          key: 'site',
          children: LinearBody({
            key: 'member',
            name: 'Misplaced Member',
            length: 1_000,
            width: 100,
            height: 200,
            material: 'Structural Steel',
          }),
        }),
      })
    );

    const result = familiesToBim(resolved, {
      project: { name: 'Invalid Hierarchy Project' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({
        kind: 'BIM_SPEC',
        code: 'FAMILIES_INVALID_CIVIL_HIERARCHY',
      });
    }
  });

  it('returns a structured BimError when Member semantics omit material', () => {
    const resolved = resolve(
      RootComposition({
        key: 'missing-material',
        children: PlaceComposition({
          key: 'site',
          children: CrossingComposition({
            key: 'bridge',
            children: SpanComposition({
              key: 'part',
              children: MateriallessBody({
                key: 'member',
                name: 'Materialless Member',
                length: 1_000,
                width: 100,
                height: 200,
              }),
            }),
          }),
        }),
      })
    );

    const result = familiesToBim(resolved, {
      project: { name: 'Missing Material Project' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({
        kind: 'BIM_SPEC',
        code: 'FAMILIES_MISSING_SEMANTIC_MATERIAL',
      });
    }
  });

  it('returns a structured BimError for malformed untyped Member material semantics', () => {
    const resolved = resolve(
      RootComposition({
        key: 'malformed-material',
        children: PlaceComposition({
          key: 'site',
          children: CrossingComposition({
            key: 'bridge',
            children: SpanComposition({
              key: 'part',
              children: LinearBody({
                key: 'member',
                name: 'Malformed Material Member',
                length: 1_000,
                width: 100,
                height: 200,
                material: 'Structural Steel',
              }),
            }),
          }),
        }),
      })
    );
    const member = resolved.children[0]?.children[0]?.children[0]?.children[0];
    expect(member?.semantics).toBeDefined();
    if (member?.semantics === undefined) return;
    Object.defineProperty(member.semantics, 'material', { value: 42 });

    const result = familiesToBim(resolved, {
      project: { name: 'Malformed Material Project' },
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        kind: 'BIM_SPEC',
        code: 'FAMILIES_MISSING_SEMANTIC_MATERIAL',
      },
    });
  });
});
