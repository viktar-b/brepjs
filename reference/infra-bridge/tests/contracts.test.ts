import { describe, expect, it } from 'vitest';
import { referenceHarnessError, type ReconstructionTarget } from '@brepjs/infra-bridge-reference';
import {
  analyticEvidenceFixture,
  fromIndexedFaceSet,
  fromTriangulatedSolid,
  indexedFaceSetFixture,
  referenceSceneFixture,
  triangulatedSolidFixture,
} from './syntheticFixtures.js';

describe('source-neutral Reference Harness contracts', () => {
  it('lets source-specific representation adapters converge on one Reconstruction Target', () => {
    const indexedTarget: ReconstructionTarget = fromIndexedFaceSet(indexedFaceSetFixture);
    const triangulatedTarget: ReconstructionTarget =
      fromTriangulatedSolid(triangulatedSolidFixture);

    expect(indexedTarget).toEqual(triangulatedTarget);
    expect(indexedTarget).not.toHaveProperty('points');
    expect(indexedTarget).not.toHaveProperty('faces');
    expect(indexedTarget).not.toHaveProperty('positions');
    expect(indexedTarget).not.toHaveProperty('indices');
  });

  it('represents scene hierarchy and placement without a source-format type', () => {
    expect(referenceSceneFixture).toMatchObject({
      unit: 'millimetre',
      roots: [
        {
          kind: 'spatial',
          referenceKey: 'synthetic-root',
          children: [
            {
              kind: 'product',
              targetKey: 'synthetic-member',
              localFrame: { origin: [100, 0, 0] },
            },
          ],
        },
      ],
    });
    expect(JSON.stringify(referenceSceneFixture)).not.toMatch(/ifc|brep|mesh/i);
  });

  it('adds optional analytic evidence without changing the comparison surface', () => {
    const target: ReconstructionTarget = {
      ...fromIndexedFaceSet(indexedFaceSetFixture),
      analyticEvidence: analyticEvidenceFixture,
    };

    expect(target.comparisonSurface).toEqual(
      fromIndexedFaceSet(indexedFaceSetFixture).comparisonSurface
    );
    expect(target.analyticEvidence?.surfaces.map((surface) => surface.kind)).toEqual([
      'plane',
      'cylinder',
    ]);
  });

  it.each([
    'UNSUPPORTED_REPRESENTATION',
    'INVALID_INDICES',
    'PLACEMENT_FAILURE',
    'UNIT_FAILURE',
    'OPEN_TOPOLOGY',
    'INVALID_TOPOLOGY',
    'CHECKSUM_MISMATCH',
  ] as const)('provides the structured %s error', (code) => {
    expect(referenceHarnessError(code, 'synthetic failure', { referenceKey: 'fixture' })).toEqual({
      code,
      message: 'synthetic failure',
      context: { referenceKey: 'fixture' },
    });
  });
});
