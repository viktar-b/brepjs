/** @jsxImportSource brepjs-families */

import { beforeAll, describe, expect, it } from 'vitest';
import { csg, unwrap } from 'brepjs';
import { familiesToBim } from 'brepjs-bim';
import { assembly, el, family, model, evaluateModel, resolve } from 'brepjs-families';
import { projectInfraBridge } from '../src/projectInfraBridge.js';

beforeAll(async () => {
  await import('brepjs/quick');
}, 30_000);

const ParityMember = family<{ label?: string }>(
  'ParityMember',
  () => el('Geometry', { node: csg.box(10, 2, 3) }),
  {
    semantics: {
      kind: 'member',
      role: 'arch-segment',
      material: 'parity-steel',
      properties: { name: 'Parity member', length: 10, width: 2, height: 3 },
    },
  }
);

const ParityPart = assembly<{ label?: string }>(
  'ParityPart',
  () => el('Group', {}, [<ParityMember key="member" />]),
  {
    semantics: {
      kind: 'bridge-part',
      role: 'superstructure',
      properties: { name: 'Parity part', usage: 'longitudinal' },
    },
  }
);

const ParityBridge = assembly<{ label?: string }>(
  'ParityBridge',
  () => el('Group', {}, [<ParityPart key="part" />]),
  {
    semantics: { kind: 'bridge', role: 'arched', properties: { name: 'Parity bridge' } },
  }
);

const ParitySite = assembly<{ label?: string }>(
  'ParitySite',
  () => el('Group', {}, [<ParityBridge key="bridge" />]),
  { semantics: { kind: 'site', properties: { name: 'Parity site' } } }
);

const ParityModel = model<{ label?: string }>(
  'ParityModel',
  () => el('Group', {}, [<ParitySite key="site" />]),
  { semantics: { kind: 'project', properties: { name: 'Parity project' } } }
);

describe('nested-part public BimModel fallback', () => {
  it('stays semantically equivalent to familiesToBim for a non-nested civil slice', () => {
    const root = resolve(<ParityModel key="parity" />);
    using evaluator = new csg.Evaluator();
    const evaluated = evaluateModel(root, evaluator);
    const preferred = unwrap(
      familiesToBim(root, {
        project: { name: 'Parity project', projectId: 'infra-bridge' },
        evaluatedModel: evaluated,
      })
    );
    const fallback = unwrap(projectInfraBridge(root, evaluated));
    using preferredModel = preferred.model;
    using fallbackModel = fallback.model;

    expect([...fallback.idByKeyPath.keys()]).toEqual([...preferred.idByKeyPath.keys()]);
    for (const [keyPath, preferredId] of preferred.idByKeyPath) {
      const fallbackId = fallback.idByKeyPath.get(keyPath);
      expect(fallbackId, keyPath).toBeDefined();
      if (fallbackId === undefined) continue;
      const preferredElement = preferredModel.getElement(preferredId);
      const fallbackElement = fallbackModel.getElement(fallbackId);
      expect(fallbackElement, keyPath).toMatchObject({
        category: preferredElement?.category,
        guid: preferredElement?.guid,
        spec: preferredElement?.spec,
      });
      expect(fallbackElement?.productBody?.kind, keyPath).toBe(preferredElement?.productBody?.kind);
    }
    expect(fallbackModel.getAllRelationships()).toEqual(preferredModel.getAllRelationships());
  });
});
