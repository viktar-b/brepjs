import { describe, expect, it } from 'vitest';
import { loadReference } from '@brepjs/infra-bridge-reference';
import {
  ANALYTIC_BREP_GLOBAL_ID,
  analyticBrepSha256,
  syntheticAnalyticBrepIfc,
} from './analyticBrepIfcFixture.js';

describe('Reference Harness analytic B-Rep decoder', () => {
  it('decodes a complete planar AdvancedBrep through the common public interface', async () => {
    const bytes = syntheticAnalyticBrepIfc();
    const result = await loadReference(requestFor(bytes));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const target = result.value.targets[0];
    expect(target?.comparisonSurface).toMatchObject({ unit: 'millimetre', closed: true });
    expect(target?.comparisonSurface.vertices).toEqual([
      [0, 0, 0],
      [0, 0, 40],
      [0, 30, 0],
      [0, 30, 40],
      [20, 0, 0],
      [20, 0, 40],
      [20, 30, 0],
      [20, 30, 40],
    ]);
    expect(target?.comparisonSurface.triangles).toHaveLength(12);
    expect(target?.dimensions).toEqual([
      { name: 'envelope-x', value: 20, unit: 'millimetre' },
      { name: 'envelope-y', value: 30, unit: 'millimetre' },
      { name: 'envelope-z', value: 40, unit: 'millimetre' },
    ]);
    expect(target?.analyticEvidence).toMatchObject({
      topology: { vertexCount: 8, edgeCount: 12, faceCount: 6, closed: true },
    });
    expect(target?.analyticEvidence?.surfaces).toHaveLength(6);
    expect(target?.analyticEvidence?.curves).toHaveLength(12);
    expect(target?.analyticEvidence?.surfaces[0]).toMatchObject({
      kind: 'plane',
      point: [0, 0, 0],
    });
    expect(target?.analyticEvidence?.curves[0]).toMatchObject({
      kind: 'line',
      point: [0, 0, 0],
      start: [0, 0, 0],
      end: [20, 0, 0],
    });
    expect(target?.analyticEvidence?.topology).toMatchObject({
      vertices: target?.comparisonSurface.vertices,
      edges: expect.arrayContaining([{ vertices: [0, 4] }]),
      faces: expect.arrayContaining([
        {
          vertices: [0, 2, 6, 4],
          edges: expect.any(Array),
        },
      ]),
    });
    expect(result.value.scene.roots[0]).toMatchObject({
      name: 'Analytic Box',
      material: 'Analytic Steel',
      localFrame: { origin: [100, 210, 5], xAxis: [0, 1, 0], zAxis: [0, 0, 1] },
      worldFrame: { origin: [100, 210, 5], xAxis: [0, 1, 0], zAxis: [0, 0, 1] },
    });
    expect(JSON.stringify(result.value)).not.toMatch(
      /Ifc|ExpressId|GlobalId|AdvancedBrep|ClosedShell|EdgeCurve|AdvancedFace/
    );
    expect(JSON.stringify(result.value)).not.toContain(ANALYTIC_BREP_GLOBAL_ID);
  });

  it('returns OPEN_TOPOLOGY for a shell with a missing face', async () => {
    const bytes = syntheticAnalyticBrepIfc({ topology: 'open' });
    const result = await loadReference(requestFor(bytes));
    expect(result).toMatchObject({ ok: false, error: { code: 'OPEN_TOPOLOGY' } });
  });

  it('returns INVALID_TOPOLOGY for a discontinuous oriented edge loop', async () => {
    const bytes = syntheticAnalyticBrepIfc({ topology: 'broken-loop' });
    const result = await loadReference(requestFor(bytes));
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_TOPOLOGY' } });
  });

  it('rejects an unsupported non-rectangular advanced face instead of fan triangulating it', async () => {
    const bytes = syntheticAnalyticBrepIfc({ topology: 'non-rectangular' });
    const result = await loadReference(requestFor(bytes));
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_TOPOLOGY' } });
  });

  it('rejects unsupported analytic surfaces and bare child entities', async () => {
    const cylinder = syntheticAnalyticBrepIfc({ surface: 'cylinder' });
    const bareFace = syntheticAnalyticBrepIfc({ bodyItem: 'advanced-face' });
    expect(await loadReference(requestFor(cylinder))).toMatchObject({
      ok: false,
      error: { code: 'UNSUPPORTED_REPRESENTATION' },
    });
    expect(await loadReference(requestFor(bareFace))).toMatchObject({
      ok: false,
      error: { code: 'UNSUPPORTED_REPRESENTATION' },
    });
  });

  it('recomputes analytic envelope dimensions after a rotated mapped occurrence', async () => {
    const bytes = syntheticAnalyticBrepIfc({ mapped: true });
    const result = await loadReference(requestFor(bytes));

    expect(result).toMatchObject({
      ok: true,
      value: {
        targets: [
          {
            dimensions: [
              { name: 'envelope-x', value: 30, unit: 'millimetre' },
              { name: 'envelope-y', value: 20, unit: 'millimetre' },
              { name: 'envelope-z', value: 40, unit: 'millimetre' },
            ],
          },
        ],
      },
    });
  });
});

function requestFor(bytes: Uint8Array) {
  return {
    bytes,
    manifest: {
      checksum: analyticBrepSha256(bytes),
      mappings: [
        {
          semanticKey: 'analytic-box',
          referenceGlobalId: ANALYTIC_BREP_GLOBAL_ID,
        },
      ],
    },
  };
}
