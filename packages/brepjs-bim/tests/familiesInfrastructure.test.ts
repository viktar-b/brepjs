import { beforeAll, describe, expect, it } from 'vitest';
import { csg, getBounds, measureVolume, unwrap } from 'brepjs';
import {
  assembly,
  el,
  family,
  frame,
  model,
  normalizeChildren,
  resolve,
  type ElementChild,
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
      properties: { name, length, width, height },
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
      properties: { name, length, width, height },
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

function flattenSpatial(root: ImportedSpatialNode | null): ImportedSpatialNode[] {
  if (root === null) return [];
  return [root, ...root.children.flatMap((child) => flattenSpatial(child))];
}

beforeAll(async () => {
  await initOCCT();
}, 30_000);

describe('families infrastructure projection', () => {
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
    expect(bim.getAllRelationships()).toEqual(
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
