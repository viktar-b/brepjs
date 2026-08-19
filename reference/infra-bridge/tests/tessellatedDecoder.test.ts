import { describe, expect, it } from 'vitest';
import { loadReference, type LoadReferenceRequest } from '@brepjs/infra-bridge-reference';
import {
  sha256,
  SYNTHETIC_MEMBER_GLOBAL_ID,
  syntheticTessellatedIfc,
} from './tessellatedIfcFixture.js';

describe('Reference Harness tessellated IFC decoder', () => {
  it('decodes a complete face set into a local target and separate scene placement', async () => {
    const bytes = syntheticTessellatedIfc();
    const result = await loadReference({
      bytes,
      manifest: {
        checksum: sha256(bytes),
        mappings: [
          {
            semanticKey: 'synthetic-member',
            referenceGlobalId: SYNTHETIC_MEMBER_GLOBAL_ID,
          },
        ],
      },
    });

    expect(result).toEqual({
      ok: true,
      value: {
        targets: [
          {
            semanticKey: 'synthetic-member',
            comparisonSurface: {
              unit: 'millimetre',
              vertices: [
                [0, 0, 0],
                [10, 0, 0],
                [0, 10, 0],
                [0, 0, 10],
              ],
              triangles: [
                [0, 2, 1],
                [0, 1, 3],
                [1, 2, 3],
                [2, 0, 3],
              ],
              closed: true,
            },
          },
        ],
        scene: {
          unit: 'millimetre',
          roots: [
            {
              kind: 'product',
              referenceKey: 'synthetic-member',
              name: 'Synthetic Member',
              material: 'Synthetic Steel',
              targetKey: 'synthetic-member',
              localFrame: {
                origin: [100, 210, 5],
                xAxis: [0, 1, 0],
                zAxis: [0, 0, 1],
              },
              worldFrame: {
                origin: [100, 210, 5],
                xAxis: [0, 1, 0],
                zAxis: [0, 0, 1],
              },
            },
          ],
        },
      },
    });

    if (!result.ok) return;
    expect(JSON.stringify(result.value.targets[0])).not.toMatch(
      /Coordinates|CoordList|CoordIndex|PnIndex|IfcTriangulatedFaceSet/
    );
    expect(JSON.stringify(result.value)).not.toContain(SYNTHETIC_MEMBER_GLOBAL_ID);
    expect(JSON.stringify(result.value)).not.toMatch(/expressId/i);
  });

  it('returns INVALID_INDICES for a malformed one-based CoordIndex', async () => {
    const result = await loadReference(
      requestFor(syntheticTessellatedIfc({ indexCase: 'zero-based' }))
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INDICES' } });
  });

  it('addresses Coordinates directly when PnIndex is absent', async () => {
    const result = await loadReference(requestFor(syntheticTessellatedIfc({ pnIndex: 'absent' })));

    expect(result).toMatchObject({
      ok: true,
      value: {
        targets: [
          {
            semanticKey: 'synthetic-member',
            comparisonSurface: {
              unit: 'millimetre',
              vertices: [
                [0, 0, 0],
                [10, 0, 0],
                [0, 10, 0],
                [0, 0, 10],
              ],
              triangles: [
                [0, 2, 1],
                [0, 1, 3],
                [1, 2, 3],
                [2, 0, 3],
              ],
              closed: true,
            },
          },
        ],
      },
    });
  });

  it('returns INVALID_INDICES for an out-of-range PnIndex', async () => {
    const result = await loadReference(
      requestFor(syntheticTessellatedIfc({ pnIndex: 'out-of-range' }))
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INDICES' } });
  });

  it('returns CHECKSUM_MISMATCH before decoding changed reference bytes', async () => {
    const expectedBytes = syntheticTessellatedIfc();
    const changedBytes = expectedBytes.slice();
    changedBytes[0] = 'X'.charCodeAt(0);
    const request = requestFor(expectedBytes);
    const result = await loadReference({
      ...request,
      bytes: changedBytes,
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'CHECKSUM_MISMATCH' } });
  });

  it('does not accept a bare point list as product geometry', async () => {
    const result = await loadReference(
      requestFor(syntheticTessellatedIfc({ representation: 'bare-point-list' }))
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'UNSUPPORTED_REPRESENTATION' },
    });
  });

  it('selects the complete Body item when the product also has an Axis representation', async () => {
    const result = await loadReference(
      requestFor(syntheticTessellatedIfc({ representationSet: 'axis-and-body' }))
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        targets: [
          {
            semanticKey: 'synthetic-member',
            comparisonSurface: {
              vertices: [
                [0, 0, 0],
                [10, 0, 0],
                [0, 10, 0],
                [0, 0, 10],
              ],
              triangles: [
                [0, 2, 1],
                [0, 1, 3],
                [1, 2, 3],
                [2, 0, 3],
              ],
            },
          },
        ],
      },
    });
  });

  it.each([
    [syntheticTessellatedIfc({ placement: 'missing' }), 'PLACEMENT_FAILURE'],
    [syntheticTessellatedIfc({ lengthUnit: 'angle-only' }), 'UNIT_FAILURE'],
    [syntheticTessellatedIfc({ closed: false }), 'OPEN_TOPOLOGY'],
    [syntheticTessellatedIfc({ indexCase: 'open-shell' }), 'INVALID_TOPOLOGY'],
  ] as const)('returns a structured decoder error without throwing', async (bytes, code) => {
    const result = await loadReference(requestFor(bytes));

    expect(result).toMatchObject({ ok: false, error: { code } });
  });
});

function requestFor(bytes: Uint8Array): LoadReferenceRequest {
  return {
    bytes,
    manifest: {
      checksum: sha256(bytes),
      mappings: [
        {
          semanticKey: 'synthetic-member',
          referenceGlobalId: SYNTHETIC_MEMBER_GLOBAL_ID,
        },
      ],
    },
  };
}
