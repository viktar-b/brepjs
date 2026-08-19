/** @jsxImportSource brepjs-families */

import { beforeAll, describe, expect, it } from 'vitest';
import { csg, unwrap } from 'brepjs';
import {
  disposeImportedModel,
  familiesToBim,
  fromIfc,
  hasErrors,
  toIfcValidated,
} from 'brepjs-bim';
import { evaluateModel, resolve } from 'brepjs-families';
import { buildInfraBridge } from '../src/main.js';

beforeAll(async () => {
  await import('brepjs/quick');
}, 30_000);

describe('Gate 3 road bridge slice', () => {
  it('preserves the declarative hierarchy, semantic keys, and nested Frames', () => {
    const root = resolve(buildInfraBridge());
    expect(root.keyPath).toBe('infra-bridge');
    expect(root.semantics?.kind).toBe('project');
    const site = root.children[0];
    const bridge = site?.children[0];
    expect(site).toMatchObject({
      keyPath: 'infra-bridge/road-site',
      semantics: { kind: 'site' },
    });
    expect(bridge).toMatchObject({
      keyPath: 'infra-bridge/road-site/road-river-bridge',
      semantics: { kind: 'bridge' },
    });
    expect(bridge?.children.map(({ keyPath }) => keyPath.split('/').at(-1))).toEqual([
      'deck',
      'pier',
    ]);
    expect(
      bridge?.children.flatMap(({ children }) =>
        children.map(({ keyPath }) => keyPath.split('/').at(-1))
      )
    ).toEqual(['bridge-deck', 'main-girder', 'cross-girder', 'pier-stem', 'footing']);

    const crossGirder = bridge?.children[1]?.children[0];
    expect(crossGirder?.localFrame).toMatchObject({
      origin: [2_000, -150, -756],
      xAxis: [1, 0, 0],
      zAxis: [0, 0, 1],
    });
  });

  it('projects only typed infrastructure entities and validates/reimports IFC4X3', async () => {
    const root = resolve(buildInfraBridge());
    using evaluator = new csg.Evaluator();
    const evaluatedModel = evaluateModel(root, evaluator);
    const projected = unwrap(
      familiesToBim(root, {
        project: { name: 'Gate 3 road bridge slice', projectId: 'infra-bridge' },
        evaluatedModel,
      })
    );
    using bim = projected.model;
    expect(bim.getBridges()).toHaveLength(1);
    expect(bim.getBridgeParts()).toHaveLength(2);
    expect(bim.getSlabs()).toHaveLength(1);
    expect(bim.getBeams()).toHaveLength(2);
    expect(bim.getColumns()).toHaveLength(1);
    expect(bim.getFootings()).toHaveLength(1);
    expect(bim.getProxies()).toHaveLength(0);
    expect(bim.getBuildings()).toHaveLength(0);
    expect(bim.getStoreys()).toHaveLength(0);

    const validated = unwrap(
      await toIfcValidated(bim, {
        applicationName: 'brepjs Gate 3',
        applicationVersion: '1',
        ifcSchema: 'IFC4X3',
      })
    );
    expect(hasErrors(validated.report), JSON.stringify(validated.report.issues)).toBe(false);
    const imported = unwrap(await fromIfc(validated.bytes));
    try {
      expect(imported.schema).toBe('IFC4X3');
      expect(imported.spatialTree?.children[0]?.children[0]).toMatchObject({
        category: 'BRIDGE',
      });
      expect(imported.elements.map(({ category }) => category).sort()).toEqual([
        'BEAM',
        'BEAM',
        'COLUMN',
        'FOOTING',
        'SLAB',
      ]);
      const deck = imported.elements.find(({ category }) => category === 'SLAB');
      const beamLengths = imported.elements
        .filter(({ category }) => category === 'BEAM')
        .map((element) => quantity(element, 'Qto_BeamBaseQuantities', 'Length'))
        .filter((value): value is number => value !== undefined)
        .sort((a, b) => a - b);
      expect(deck?.psets.map(({ name }) => name)).toContain('Qto_SlabBaseQuantities');
      expect(quantity(deck, 'Qto_SlabBaseQuantities', 'Length')).toBeCloseTo(9.909, 6);
      expect(quantity(deck, 'Qto_SlabBaseQuantities', 'Width')).toBeCloseTo(3.368, 6);
      expect(beamLengths[0]).toBeCloseTo(4, 5);
      expect(beamLengths[1]).toBeCloseTo(9.891, 5);
    } finally {
      disposeImportedModel(imported);
    }
  }, 30_000);
});

function quantity(
  element:
    | {
        readonly psets: readonly {
          readonly name: string;
          readonly properties: Readonly<Record<string, string | number | boolean>>;
        }[];
      }
    | undefined,
  setName: string,
  propertyName: string
): number | undefined {
  const value = element?.psets.find(({ name }) => name === setName)?.properties[propertyName];
  return typeof value === 'number' ? value : undefined;
}
