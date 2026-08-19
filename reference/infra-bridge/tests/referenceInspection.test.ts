import { describe, expect, it } from 'vitest';
import { inspectReference } from '@brepjs/infra-bridge-reference';
import {
  sha256,
  SYNTHETIC_MEMBER_GLOBAL_ID,
  syntheticTessellatedIfc,
} from './tessellatedIfcFixture.js';

describe('Reference Harness inspection', () => {
  it('reports checksummed source structure only through the harness interface', async () => {
    const bytes = syntheticTessellatedIfc();
    const result = await inspectReference(bytes);

    expect(result).toMatchObject({
      ok: true,
      value: {
        checksum: sha256(bytes),
        schema: 'IFC4X3_ADD2',
        millimetresPerFileUnit: 10,
        entityCounts: { IfcMember: 1, IfcTriangulatedFaceSet: 1 },
        products: [
          {
            referenceGlobalId: SYNTHETIC_MEMBER_GLOBAL_ID,
            entityType: 'IfcMember',
            name: 'Synthetic Member',
            material: 'Synthetic Steel',
            representationItemTypes: ['Body:IfcTriangulatedFaceSet'],
            worldFrame: { origin: [100, 210, 5] },
          },
        ],
      },
    });
  });
});
