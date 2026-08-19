/** @jsxImportSource brepjs-families */

import { beforeAll, describe, expect, it } from 'vitest';
import { csg, unwrap } from 'brepjs';
import {
  disposeImportedModel,
  fromIfc,
  hasErrors,
  toIfcValidated,
  type BimModel,
  type LocalId,
} from 'brepjs-bim';
import { evaluateModel, resolve, type ResolvedElement } from 'brepjs-families';
import { buildInfraBridge } from '../src/main.js';
import { projectInfraBridge } from '../src/projectInfraBridge.js';

beforeAll(async () => {
  await import('brepjs/quick');
}, 30_000);

const PRODUCT_CATEGORY = {
  beam: 'BEAM',
  column: 'COLUMN',
  'earthworks-fill': 'EARTHWORKS_FILL',
  footing: 'FOOTING',
  member: 'MEMBER',
  railing: 'RAILING',
  sign: 'SIGN',
  slab: 'SLAB',
  wall: 'WALL',
} as const;

describe('complete declarative infrastructure bridge model', () => {
  it('resolves exactly three Bridges, eighteen BridgeParts, and 47 scoped products', async () => {
    const root = resolve(await buildInfraBridge());
    const nodes = flatten(root);
    expect(root).toMatchObject({
      type: 'InfraBridge',
      keyPath: 'infra-bridge',
      semantics: { kind: 'project' },
    });
    expect(nodes.filter(({ semantics }) => semantics?.kind === 'site')).toHaveLength(3);
    expect(nodes.filter(({ semantics }) => semantics?.kind === 'bridge')).toHaveLength(3);
    expect(nodes.filter(({ semantics }) => semantics?.kind === 'bridge-part')).toHaveLength(18);
    expect(productNodes(nodes)).toHaveLength(47);

    const railBridges = nodes.filter(({ semantics }) => semantics?.kind === 'bridge').slice(1);
    expect(railBridges.map(({ type }) => type)).toEqual(['RailArchBridge', 'RailArchBridge']);
    expect(new Set(nodes.map(({ keyPath }) => keyPath)).size).toBe(nodes.length);
  });

  it('projects every occurrence with its semantic class, containment, material, and stable identity', async () => {
    const root = resolve(await buildInfraBridge());
    using evaluator = new csg.Evaluator();
    const evaluated = evaluateModel(root, evaluator);
    const first = unwrap(projectInfraBridge(root, evaluated));
    const second = unwrap(projectInfraBridge(root, evaluated));
    using firstModel = first.model;
    using secondModel = second.model;
    const firstRelationships = firstModel.getAllRelationships();
    const secondGuidByPath = guidByPath(secondModel, second.idByKeyPath);

    for (const node of productNodes(flatten(root))) {
      const id = first.idByKeyPath.get(node.keyPath);
      expect(id, node.keyPath).toBeDefined();
      if (id === undefined) continue;
      const element = firstModel.getElement(id);
      const semanticKind = node.semantics?.kind;
      expect(element?.category, node.keyPath).toBe(
        PRODUCT_CATEGORY[semanticKind as keyof typeof PRODUCT_CATEGORY]
      );
      expect(secondGuidByPath.get(node.keyPath), node.keyPath).toBe(element?.guid);

      const material = firstRelationships.find(
        (relationship) =>
          relationship.kind === 'ASSOCIATES_MATERIAL' && relationship.relatedObjects.includes(id)
      );
      expect(material, node.keyPath).toMatchObject({
        kind: 'ASSOCIATES_MATERIAL',
        materialName: node.semantics?.material,
      });

      const parentPath = node.keyPath.slice(0, node.keyPath.lastIndexOf('/'));
      const parentId = first.idByKeyPath.get(parentPath);
      expect(
        firstRelationships.some(
          (relationship) =>
            relationship.kind === 'CONTAINED_IN' &&
            relationship.relatingStructure === parentId &&
            relationship.relatedElements.includes(id)
        ),
        node.keyPath
      ).toBe(true);
    }

    expect(firstModel.getBridges()).toHaveLength(3);
    expect(firstModel.getBridgeParts()).toHaveLength(18);
    expect(firstModel.getBeams()).toHaveLength(8);
    expect(firstModel.getColumns()).toHaveLength(7);
    expect(firstModel.getEarthworksFills()).toHaveLength(4);
    expect(firstModel.getFootings()).toHaveLength(7);
    expect(firstModel.getMembers()).toHaveLength(8);
    expect(firstModel.getRailings()).toHaveLength(2);
    expect(firstModel.getSigns()).toHaveLength(4);
    expect(firstModel.getSlabs()).toHaveLength(3);
    expect(firstModel.getWalls()).toHaveLength(4);
    expect(firstModel.getProxies()).toHaveLength(0);
    expect(firstModel.getBuildings()).toHaveLength(0);
    expect(firstModel.getStoreys()).toHaveLength(0);
  });

  it('serializes valid typed IFC4X3 and reimports the complete hierarchy', async () => {
    const root = resolve(await buildInfraBridge());
    using evaluator = new csg.Evaluator();
    const evaluated = evaluateModel(root, evaluator);
    const projected = unwrap(projectInfraBridge(root, evaluated));
    using bim = projected.model;
    const validated = unwrap(
      await toIfcValidated(bim, {
        applicationName: 'brepjs declarative infra bridge',
        applicationVersion: '1',
        ifcSchema: 'IFC4X3',
      })
    );
    expect(hasErrors(validated.report), JSON.stringify(validated.report.issues)).toBe(false);

    const imported = unwrap(await fromIfc(validated.bytes));
    try {
      expect(imported.schema).toBe('IFC4X3');
      expect(imported.diagnostics.issues.filter(({ severity }) => severity === 'error')).toEqual(
        []
      );
      const spatial = imported.spatialTree === null ? [] : flattenSpatial(imported.spatialTree);
      expect(spatial.filter(({ category }) => category === 'BRIDGE')).toHaveLength(3);
      expect(spatial.filter(({ category }) => category === 'BRIDGE_PART')).toHaveLength(18);
      expect(imported.elements).toHaveLength(47);
      expect(categoryCounts(imported.elements.map(({ category }) => category))).toEqual({
        BEAM: 8,
        COLUMN: 7,
        EARTHWORKS_FILL: 4,
        FOOTING: 7,
        MEMBER: 8,
        RAILING: 2,
        SIGN: 4,
        SLAB: 3,
        WALL: 4,
      });
      expect(imported.elements.every(({ material }) => material?.name !== undefined)).toBe(true);

      expectAnyQuantityCloseTo(
        quantities(imported.elements, 'SLAB', 'Qto_SlabBaseQuantities', 'Length'),
        9.909
      );
      expectAnyQuantityCloseTo(
        quantities(imported.elements, 'SLAB', 'Qto_SlabBaseQuantities', 'Width'),
        3.368
      );
      expectQuantitiesCloseTo(
        quantities(imported.elements, 'BEAM', 'Qto_BeamBaseQuantities', 'Length'),
        [3.6, 3.6, 4, 4, 4, 9.891, 9.891, 9.891]
      );
      expectQuantitiesCloseTo(
        quantities(imported.elements, 'COLUMN', 'Qto_ColumnBaseQuantities', 'Length'),
        [2.286321, 2.286321, 2.286321, 3.780346, 3.780346, 3.780346, 3.780346]
      );
      expectQuantitiesCloseTo(
        quantities(imported.elements, 'WALL', 'Qto_WallBaseQuantities', 'Length'),
        [20, 20, 20, 20]
      );
      expectQuantitiesCloseTo(
        quantities(imported.elements, 'WALL', 'Qto_WallBaseQuantities', 'Width'),
        [0.45, 0.45, 0.45, 0.45]
      );
      expectQuantitiesCloseTo(
        quantities(imported.elements, 'FOOTING', 'Qto_FootingBaseQuantities', 'Length'),
        [5, 5, 5, 6.4, 6.4, 6.4, 6.4]
      );
      expectQuantitiesCloseTo(
        quantities(imported.elements, 'FOOTING', 'Qto_FootingBaseQuantities', 'Height'),
        [0.7, 0.7, 0.7, 1, 1, 1, 1]
      );
    } finally {
      disposeImportedModel(imported);
    }
  }, 60_000);
});

function flatten(root: ResolvedElement): readonly ResolvedElement[] {
  return [root, ...root.children.flatMap(flatten)];
}

function productNodes(nodes: readonly ResolvedElement[]): readonly ResolvedElement[] {
  return nodes.filter(({ semantics }) =>
    semantics === undefined ? false : semantics.kind in PRODUCT_CATEGORY
  );
}

function guidByPath(
  model: BimModel,
  ids: ReadonlyMap<string, LocalId>
): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  for (const [path, id] of ids) {
    const element = model.getElement(id);
    if (element !== null) result.set(path, element.guid);
  }
  return result;
}

function flattenSpatial<T extends { readonly children: readonly T[] }>(root: T): readonly T[] {
  return [root, ...root.children.flatMap(flattenSpatial)];
}

function categoryCounts(categories: readonly string[]): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const category of categories) counts[category] = (counts[category] ?? 0) + 1;
  return counts;
}

function quantities(
  elements: readonly {
    readonly category: string;
    readonly psets: readonly {
      readonly name: string;
      readonly properties: Readonly<Record<string, string | number | boolean>>;
    }[];
  }[],
  category: string,
  setName: string,
  propertyName: string
): readonly number[] {
  return elements
    .filter((element) => element.category === category)
    .flatMap((element) => {
      const value = element.psets.find(({ name }) => name === setName)?.properties[propertyName];
      return typeof value === 'number' ? [value] : [];
    })
    .sort((left, right) => left - right);
}

function expectAnyQuantityCloseTo(actual: readonly number[], expected: number): void {
  const closest = [...actual].sort(
    (left, right) => Math.abs(left - expected) - Math.abs(right - expected)
  )[0];
  expect(closest).toBeDefined();
  if (closest !== undefined) expect(closest).toBeCloseTo(expected, 6);
}

function expectQuantitiesCloseTo(actual: readonly number[], expected: readonly number[]): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, index) => {
    const expectedValue = expected[index];
    expect(expectedValue).toBeDefined();
    if (expectedValue !== undefined) expect(value).toBeCloseTo(expectedValue, 6);
  });
}
