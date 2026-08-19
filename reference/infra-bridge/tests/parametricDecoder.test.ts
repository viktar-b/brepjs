import { describe, expect, it } from 'vitest';
import { loadReference } from '@brepjs/infra-bridge-reference';
import {
  PARAMETRIC_MEMBER_GLOBAL_ID,
  parametricSha256,
  syntheticParametricIfc,
} from './parametricIfcFixture.js';

describe('Reference Harness parametric IFC decoder', () => {
  it('decodes a positioned rectangle extrusion without a public mode flag', async () => {
    const bytes = syntheticParametricIfc();
    const result = await loadReference({
      bytes,
      manifest: {
        checksum: parametricSha256(bytes),
        mappings: [
          {
            semanticKey: 'parametric-member',
            referenceGlobalId: PARAMETRIC_MEMBER_GLOBAL_ID,
          },
        ],
      },
    });

    expect(result).toEqual({
      ok: true,
      value: {
        targets: [
          {
            semanticKey: 'parametric-member',
            comparisonSurface: {
              unit: 'millimetre',
              vertices: [
                [45, 40, 40],
                [45, 40, 20],
                [35, 40, 20],
                [35, 40, 40],
                [45, 15, 40],
                [45, 15, 20],
                [35, 15, 20],
                [35, 15, 40],
              ],
              triangles: [
                [0, 1, 2],
                [0, 2, 3],
                [4, 6, 5],
                [4, 7, 6],
                [0, 4, 5],
                [0, 5, 1],
                [1, 5, 6],
                [1, 6, 2],
                [2, 6, 7],
                [2, 7, 3],
                [3, 7, 4],
                [3, 4, 0],
              ],
              closed: true,
            },
            dimensions: [
              { name: 'profile-x-dimension', value: 20, unit: 'millimetre' },
              { name: 'profile-y-dimension', value: 10, unit: 'millimetre' },
              { name: 'extrusion-depth', value: 25, unit: 'millimetre' },
            ],
            analyticEvidence: {
              surfaces: [
                { kind: 'plane', normal: [0, 1, 0] },
                { kind: 'plane', normal: [0, -1, 0] },
                { kind: 'plane', normal: [1, 0, 0] },
                { kind: 'plane', normal: [0, 0, -1] },
                { kind: 'plane', normal: [-1, 0, 0] },
                { kind: 'plane', normal: [0, 0, 1] },
              ],
              curves: [
                { kind: 'line', direction: [0, 0, -1] },
                { kind: 'line', direction: [-1, 0, 0] },
                { kind: 'line', direction: [0, 0, 1] },
                { kind: 'line', direction: [1, 0, 0] },
                { kind: 'line', direction: [0, 0, -1] },
                { kind: 'line', direction: [-1, 0, 0] },
                { kind: 'line', direction: [0, 0, 1] },
                { kind: 'line', direction: [1, 0, 0] },
                { kind: 'line', direction: [0, -1, 0] },
                { kind: 'line', direction: [0, -1, 0] },
                { kind: 'line', direction: [0, -1, 0] },
                { kind: 'line', direction: [0, -1, 0] },
              ],
              topology: {
                vertexCount: 8,
                edgeCount: 12,
                faceCount: 6,
                closed: true,
              },
            },
          },
        ],
        scene: {
          unit: 'millimetre',
          roots: [
            {
              kind: 'product',
              referenceKey: 'parametric-member',
              name: 'Parametric Member',
              material: 'Parametric Steel',
              targetKey: 'parametric-member',
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
    expect(JSON.stringify(result.value)).not.toMatch(
      /Ifc|ExpressId|GlobalId|SweptArea|ExtrudedArea|RectangleProfile|XDim|YDim|Depth|Position/
    );
    expect(JSON.stringify(result.value)).not.toContain(PARAMETRIC_MEMBER_GLOBAL_ID);
  });

  it('returns UNSUPPORTED_REPRESENTATION for an unsupported parametric profile', async () => {
    const bytes = syntheticParametricIfc({ profile: 'circle' });
    const result = await loadReference(requestFor(bytes));

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'UNSUPPORTED_REPRESENTATION' },
    });
  });

  it('returns INVALID_TOPOLOGY for a non-positive extrusion depth', async () => {
    const bytes = syntheticParametricIfc({ depth: 'zero' });
    const result = await loadReference(requestFor(bytes));

    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_TOPOLOGY' } });
  });

  it('returns INVALID_TOPOLOGY for an extrusion direction in the profile plane', async () => {
    const bytes = syntheticParametricIfc({ direction: 'in-profile-plane' });
    const result = await loadReference(requestFor(bytes));

    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_TOPOLOGY' } });
  });

  it('returns PLACEMENT_FAILURE for a malformed solid placement', async () => {
    const bytes = syntheticParametricIfc({ placement: 'invalid-solid' });
    const result = await loadReference(requestFor(bytes));

    expect(result).toMatchObject({ ok: false, error: { code: 'PLACEMENT_FAILURE' } });
  });

  it('returns a structured error when the manifest selection is absent', async () => {
    const bytes = syntheticParametricIfc();
    const request = requestFor(bytes);
    const result = await loadReference({
      ...request,
      manifest: {
        ...request.manifest,
        mappings: [
          {
            semanticKey: 'missing-member',
            referenceGlobalId: '0123456789ABCDEFGHIJKL',
          },
        ],
      },
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'UNSUPPORTED_REPRESENTATION' },
    });
  });

  it('returns CHECKSUM_MISMATCH before parametric decoding', async () => {
    const bytes = syntheticParametricIfc();
    const request = requestFor(bytes);
    const result = await loadReference({
      ...request,
      manifest: { ...request.manifest, checksum: '0'.repeat(64) },
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'CHECKSUM_MISMATCH' } });
  });
});

function requestFor(bytes: Uint8Array) {
  return {
    bytes,
    manifest: {
      checksum: parametricSha256(bytes),
      mappings: [
        {
          semanticKey: 'parametric-member',
          referenceGlobalId: PARAMETRIC_MEMBER_GLOBAL_ID,
        },
      ],
    },
  };
}
