/** @jsxImportSource brepjs-families */

import { beforeAll, describe, expect, it } from 'vitest';
import { csg, getBounds, unwrap } from 'brepjs';
import { z } from 'zod';
import { initOCCT } from '../../../tests/setup.js';
import {
  assembly,
  civilSemantics,
  el,
  family,
  frame,
  model,
  resolve,
  type CivilEngineeringSemantics,
  type Element,
  type EngineeringSemantics,
} from '../src/index.js';

beforeAll(async () => {
  await initOCCT();
}, 30000);

interface ChildrenProps {
  readonly children: readonly Element[];
}

const Block = family<{ readonly size: number }>('Block', ({ size }) =>
  el('Box', { size: [size, size, size] })
);

const Pair = assembly<ChildrenProps>('Pair', ({ children }) => el('Group', {}, children));
const Scene = model<ChildrenProps>('Scene', ({ children }) => el('Group', {}, children));

describe('declarative definition Interface', () => {
  it('preserves Model, Assembly, and Family boundaries while flattening Fragments', () => {
    const authored = (
      <Scene key="reference-scene">
        <Pair key="paired-blocks">
          <>
            <Block key="left-block" size={10} />
            <Block key="right-block" size={20} />
          </>
        </Pair>
      </Scene>
    );
    expect(authored.children).toHaveLength(1);
    const resolved = resolve(authored);

    expect(resolved).toMatchObject({
      type: 'Scene',
      definitionKind: 'Model',
      keyPath: 'reference-scene',
    });
    expect(resolved.children[0]).toMatchObject({
      type: 'Pair',
      definitionKind: 'Assembly',
      keyPath: 'reference-scene/paired-blocks',
    });
    expect(
      resolved.children[0]?.children.map((child) => ({
        type: child.type,
        definitionKind: child.definitionKind,
        keyPath: child.keyPath,
      }))
    ).toEqual([
      {
        type: 'Block',
        definitionKind: 'Family',
        keyPath: 'reference-scene/paired-blocks/left-block',
      },
      {
        type: 'Block',
        definitionKind: 'Family',
        keyPath: 'reference-scene/paired-blocks/right-block',
      },
    ]);
    const resolvedTypes = (node: typeof resolved): string[] => [
      node.type,
      ...node.children.flatMap(resolvedTypes),
    ];
    expect(resolvedTypes(resolved)).not.toContain('Fragment');
  });

  it('preserves a wrapper definition when its render result is another definition', () => {
    const WrappedBlock = family<{ readonly size: number }>('WrappedBlock', ({ size }) =>
      Block({ size })
    );
    const resolved = resolve(<WrappedBlock key="wrapped" size={10} />);

    expect(resolved).toMatchObject({
      type: 'WrappedBlock',
      definitionKind: 'Family',
      keyPath: 'wrapped',
    });
    expect(resolved.children[0]).toMatchObject({
      type: 'Block',
      definitionKind: 'Family',
      keyPath: 'wrapped/Block[0]',
    });
    expect(resolved.geometry.structuralHash).toBe(resolved.children[0]?.geometry.structuralHash);
  });

  it('makes accepted TSX children available to the definition render function', () => {
    let renderedChildren: readonly Element[] | undefined;
    const InspectingAssembly = assembly<ChildrenProps>('InspectingAssembly', ({ children }) => {
      renderedChildren = children;
      return el('Group', {}, children);
    });

    const authored = (
      <InspectingAssembly key="assembly">
        <Block key="block" size={10} />
      </InspectingAssembly>
    );
    expect(authored.children).toHaveLength(1);
    resolve(authored);

    expect(renderedChildren).toHaveLength(1);
    expect(renderedChildren?.[0]?.key).toBe('block');
  });

  it('rejects TSX children through types when the props contract omits children', () => {
    // prettier-ignore
    // @ts-expect-error Block does not declare a children prop.
    const invalid = <Block key="parent" size={10}><Block key="child" size={5} /></Block>;
    expect(invalid).toBeDefined();
  });
});

describe('authored occurrence contract', () => {
  const RectangularBody = family<{
    readonly size: readonly [number, number, number];
  }>('RectangularBody', ({ size }) => el('Box', { size }));

  it('keeps Semantic Keys order-independent and rejects path-ambiguous keys', () => {
    const resolvedPaths = (reverse: boolean): string[] => {
      const children = [
        RectangularBody({ key: 'left-girder', size: [2, 3, 5] }),
        RectangularBody({ key: 'right-girder', size: [2, 3, 5] }),
      ];
      return resolve(
        Scene({
          key: 'bridge-model',
          children: reverse ? [...children].reverse() : children,
        })
      )
        .children.map((child) => child.keyPath)
        .sort();
    };

    expect(resolvedPaths(false)).toEqual(resolvedPaths(true));
    expect(resolvedPaths(false)).toEqual(['bridge-model/left-girder', 'bridge-model/right-girder']);
    expect(() => RectangularBody({ key: '', size: [2, 3, 5] })).toThrow(/semantic key/i);
    expect(() => RectangularBody({ key: 'deck/main', size: [2, 3, 5] })).toThrow(/semantic key/i);
    expect(() =>
      resolve(
        Scene({
          key: 'duplicate-model',
          children: [
            RectangularBody({ key: 'member', size: [2, 3, 5] }),
            RectangularBody({ key: 'member', size: [2, 3, 5] }),
          ],
        })
      )
    ).toThrow(/duplicate sibling key/i);
  });

  it('derives Engineering Semantics from definition-owned options and typed props', () => {
    const memberProps = z.object({
      size: z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]),
      material: z.enum(['weathering-steel', 'stainless-steel']).default('weathering-steel'),
    });
    type MemberProps = z.output<typeof memberProps>;
    type MemberInput = z.input<typeof memberProps>;
    const memberSemantics = ({ material }: MemberProps): EngineeringSemantics => ({
      kind: 'longitudinal-member',
      role: 'primary',
      material,
      properties: { designLifeYears: 100, loadBearing: true },
    });
    const SemanticMember = family<MemberProps, MemberInput>(
      'SemanticMember',
      ({ size }) => el('Box', { size }),
      { props: memberProps, semantics: memberSemantics }
    );
    const RenamedSemanticMember = family<MemberProps, MemberInput>(
      'RenamedSemanticMember',
      ({ size }) => el('Box', { size }),
      { props: memberProps, semantics: memberSemantics }
    );
    const resolved = resolve(
      Scene({
        key: 'semantic-model',
        children: [
          SemanticMember({
            key: 'main-girder',
            size: [2, 3, 5],
          }),
          SemanticMember({
            key: 'edge-girder',
            size: [2, 3, 5],
            material: 'stainless-steel',
          }),
          RenamedSemanticMember({
            key: 'renamed-girder',
            size: [2, 3, 5],
            material: 'weathering-steel',
          }),
        ],
      })
    );
    const [main, edge, renamed] = resolved.children;

    expect(main?.semantics).toMatchObject({
      kind: 'longitudinal-member',
      material: 'weathering-steel',
    });
    expect(edge?.semantics).toMatchObject({
      kind: 'longitudinal-member',
      material: 'stainless-steel',
    });
    expect(renamed?.semantics?.kind).toBe('longitudinal-member');
    expect(main?.props).toEqual({
      size: [2, 3, 5],
      material: 'weathering-steel',
    });
    expect(main?.props).not.toHaveProperty('semantics');
    expect(() =>
      el('Box', {
        size: [2, 3, 5],
        semantics: { kind: 'caller-patch' },
      })
    ).toThrow(/declared on a .* definition/i);
  });

  it('lets every definition kind declare static Engineering Semantics', () => {
    const SemanticBlock = family<{ readonly size: number }>(
      'SemanticBlock',
      ({ size }) => el('Box', { size: [size, size, size] }),
      { semantics: { kind: 'solid-member' } }
    );
    const SemanticAssembly = assembly<ChildrenProps>(
      'SemanticAssembly',
      ({ children }) => el('Group', {}, children),
      { semantics: { kind: 'member-assembly' } }
    );
    const SemanticModel = model<ChildrenProps>(
      'SemanticModel',
      ({ children }) => el('Group', {}, children),
      { semantics: { kind: 'engineering-model' } }
    );
    const resolved = resolve(
      <SemanticModel key="model">
        <SemanticAssembly key="assembly">
          <SemanticBlock key="member" size={10} />
        </SemanticAssembly>
      </SemanticModel>
    );

    expect(resolved.semantics?.kind).toBe('engineering-model');
    expect(resolved.children[0]?.semantics?.kind).toBe('member-assembly');
    expect(resolved.children[0]?.children[0]?.semantics?.kind).toBe('solid-member');
  });

  it('preserves typed civil meaning from Site through physical product', () => {
    const Girder = family<{ readonly sizeMm: number }>(
      'Girder',
      ({ sizeMm }) => el('Box', { size: [sizeMm, sizeMm, sizeMm] }),
      {
        semantics: civilSemantics({
          kind: 'product',
          category: 'beam',
          role: 'main-girder',
          material: 'timber',
          dimensionsMm: { length: 9_891, width: 250, height: 300 },
        }),
      }
    );
    const Superstructure = assembly<ChildrenProps>(
      'Superstructure',
      ({ children }) => el('Group', {}, children),
      {
        semantics: civilSemantics({
          kind: 'spatial-part',
          category: 'bridge-part',
          role: 'superstructure',
          composition: 'element',
          subdivision: 'lateral',
        }),
      }
    );
    const Bridge = assembly<ChildrenProps>(
      'Bridge',
      ({ children }) => el('Group', {}, children),
      {
        semantics: civilSemantics({
          kind: 'facility',
          category: 'bridge',
          role: 'girder-bridge',
          composition: 'element',
        }),
      }
    );
    const BridgeSite = assembly<ChildrenProps>(
      'BridgeSite',
      ({ children }) => el('Group', {}, children),
      {
        semantics: civilSemantics({
          kind: 'site',
          category: 'bridge-site',
          role: 'civil-context',
          composition: 'partial',
        }),
      }
    );

    const resolved = resolve(
      <Scene key="model">
        <BridgeSite key="site">
          <Bridge key="bridge">
            <Superstructure key="superstructure">
              <Girder key="main-girder" sizeMm={10} />
            </Superstructure>
          </Bridge>
        </BridgeSite>
      </Scene>
    );

    expect(resolved.children[0]?.semantics).toEqual({
      kind: 'site',
      category: 'bridge-site',
      role: 'civil-context',
      composition: 'partial',
    });
    expect(resolved.children[0]?.children[0]?.semantics).toMatchObject({
      kind: 'facility',
      category: 'bridge',
      composition: 'element',
    });
    expect(resolved.children[0]?.children[0]?.children[0]?.semantics).toMatchObject({
      kind: 'spatial-part',
      subdivision: 'lateral',
    });
    expect(
      resolved.children[0]?.children[0]?.children[0]?.children[0]?.semantics
    ).toMatchObject({
      kind: 'product',
      category: 'beam',
      material: 'timber',
      dimensionsMm: { length: 9_891, width: 250, height: 300 },
    });
  });

  it.each([
    {
      field: 'category',
      semantics: {
        kind: 'site',
        category: '',
        role: 'civil-context',
        composition: 'partial',
      },
    },
    {
      field: 'role',
      semantics: {
        kind: 'facility',
        category: 'bridge',
        role: ' ',
        composition: 'element',
      },
    },
    {
      field: 'composition',
      semantics: {
        kind: 'site',
        category: 'bridge-site',
        role: 'civil-context',
        composition: 'aggregate',
      },
    },
    {
      field: 'subdivision',
      semantics: {
        kind: 'spatial-part',
        category: 'bridge-part',
        role: 'superstructure',
        composition: 'element',
        subdivision: 'across',
      },
    },
    {
      field: 'material',
      semantics: {
        kind: 'product',
        category: 'beam',
        role: 'main-girder',
        material: '',
        dimensionsMm: { length: 9_891 },
      },
    },
    {
      field: 'dimensionsMm.length',
      semantics: {
        kind: 'product',
        category: 'beam',
        role: 'main-girder',
        material: 'timber',
        dimensionsMm: { length: Number.NaN },
      },
    },
    {
      field: 'subdivision',
      semantics: {
        kind: 'site',
        category: 'bridge-site',
        role: 'civil-context',
        composition: 'partial',
        subdivision: 'lateral',
      },
    },
    {
      field: 'composition',
      semantics: {
        kind: 'product',
        category: 'beam',
        role: 'main-girder',
        material: 'timber',
        dimensionsMm: { length: 9_891 },
        composition: 'element',
      },
    },
  ])('rejects invalid civil semantics at $field', ({ field, semantics }) => {
    expect(() =>
      civilSemantics(semantics as unknown as CivilEngineeringSemantics)
    ).toThrow(new RegExp(`'${field.replace('.', '\\.')}'`));
  });

  it('validates civil semantics declared without the TypeScript helper', () => {
    const InvalidSpatialPart = assembly<ChildrenProps>(
      'InvalidSpatialPart',
      ({ children }) => el('Group', {}, children),
      {
        semantics: {
          kind: 'spatial-part',
          category: 'bridge-part',
          role: 'superstructure',
          composition: 'element',
        } as EngineeringSemantics,
      }
    );

    expect(() => resolve(<InvalidSpatialPart key="invalid-part" />)).toThrow(
      /assembly 'InvalidSpatialPart'\.subdivision/
    );
  });

  it('rejects civil semantics on the wrong definition responsibility', () => {
    const ProductAssembly = assembly<ChildrenProps>(
      'ProductAssembly',
      ({ children }) => el('Group', {}, children),
      {
        semantics: civilSemantics({
          kind: 'product',
          category: 'beam',
          role: 'main-girder',
          material: 'timber',
          dimensionsMm: { length: 9_891 },
        }),
      }
    );

    expect(() => resolve(<ProductAssembly key="invalid-product" />)).toThrow(
      /assembly 'ProductAssembly'\.kind.*Family/
    );
  });

  it('preserves legacy and project-defined semantic kinds', () => {
    const LegacySite = assembly<ChildrenProps>(
      'LegacySite',
      ({ children }) => el('Group', {}, children),
      { semantics: { kind: 'site', properties: { name: 'Legacy site' } } }
    );
    const CustomSystem = assembly<ChildrenProps>(
      'CustomSystem',
      ({ children }) => el('Group', {}, children),
      { semantics: { kind: 'project-defined-system', role: 'temporary-works' } }
    );

    expect(resolve(<LegacySite key="legacy-site" />).semantics).toEqual({
      kind: 'site',
      properties: { name: 'Legacy site' },
    });
    expect(resolve(<CustomSystem key="custom-system" />).semantics).toEqual({
      kind: 'project-defined-system',
      role: 'temporary-works',
    });
  });

  it.each([{ role: 'missing-kind' }, { kind: 42, role: 'non-string-kind' }])(
    'rejects malformed untyped Engineering Semantics with a domain error',
    (semantics) => {
      const UntypedDefinition = family<{ readonly size: number }>(
        'UntypedDefinition',
        ({ size }) => el('Box', { size: [size, size, size] }),
        { semantics: semantics as unknown as EngineeringSemantics }
      );

      expect(() => resolve(UntypedDefinition({ key: 'untyped', size: 10 }))).toThrow(
        /brepjs-families: engineering semantics .* requires a non-empty string kind/i
      );
    }
  );

  it('composes nested rigid Frames for resolved metadata and geometry', () => {
    const RotatedAssembly = assembly<ChildrenProps>('RotatedAssembly', ({ children }) =>
      el('Group', {}, children)
    );
    const authored = Scene({
      key: 'model',
      frame: frame({
        origin: [100, 200, 0],
        xAxis: [0, 1, 0],
        zAxis: [0, 0, 1],
      }),
      children: RotatedAssembly({
        key: 'assembly',
        frame: frame({
          origin: [10, 0, 0],
          xAxis: [1, 0, 0],
          zAxis: [0, -1, 0],
        }),
        children: RectangularBody({
          key: 'body',
          frame: frame({
            origin: [0, 0, 5],
            xAxis: [1, 0, 0],
            zAxis: [0, 0, 1],
          }),
          size: [2, 3, 5],
        }),
      }),
    });
    const resolved = resolve(authored);
    const assemblyNode = resolved.children[0];
    const bodyNode = assemblyNode?.children[0];

    expect(assemblyNode?.worldFrame).toEqual({
      origin: [100, 210, 0],
      xAxis: [0, 1, 0],
      zAxis: [1, 0, 0],
    });
    expect(bodyNode?.localFrame.origin).toEqual([0, 0, 5]);
    expect(bodyNode?.worldFrame).toEqual({
      origin: [105, 210, 0],
      xAxis: [0, 1, 0],
      zAxis: [1, 0, 0],
    });
    if (bodyNode === undefined) throw new Error('body did not resolve');
    using evaluator = new csg.Evaluator();
    const shape = unwrap(evaluator.evaluate(bodyNode.geometry));
    const bounds = getBounds(shape);
    expect(bounds.xMin).toBeCloseTo(105, 5);
    expect(bounds.xMax).toBeCloseTo(110, 5);
    expect(bounds.yMin).toBeCloseTo(210, 5);
    expect(bounds.yMax).toBeCloseTo(212, 5);
    expect(bounds.zMin).toBeCloseTo(0, 5);
    expect(bounds.zMax).toBeCloseTo(3, 5);
  });

  it('rejects non-rigid Frames before resolution', () => {
    expect(() =>
      frame({
        origin: [0, 0, 0],
        xAxis: [1, 0, 0],
        zAxis: [1, 0, 0],
      })
    ).toThrow(/orthogonal/i);
  });
});
