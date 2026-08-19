import type { ShapeMesh } from 'brepjs';
import { describe, expect, it } from 'vitest';
import {
  renderMatchedComparison,
  SNAPSHOT_VIEWS,
  type SnapshotEntry,
} from '../src/snapshotRenderer.js';

describe('matched-camera snapshot renderer', () => {
  it('uses the union camera for Reference, authored output, and overlay panels', () => {
    const view = SNAPSHOT_VIEWS.find(({ key }) => key === 'plan');
    if (view === undefined) throw new Error('Plan view is missing');
    const reference: readonly SnapshotEntry[] = [{ mesh: triangleMesh(0), color: '#a87543' }];
    const output: readonly SnapshotEntry[] = [{ mesh: triangleMesh(10), color: '#5f7891' }];

    const result = renderMatchedComparison(reference, output, view);

    expect(result.camera.xMin).toBeCloseTo(0, 8);
    expect(result.camera.xMax).toBeCloseTo(11, 8);
    expect(result.camera.yMin).toBeCloseTo(0, 8);
    expect(result.camera.yMax).toBeCloseTo(1, 8);
    expect(result.svg).toContain('Reference · Plan');
    expect(result.svg).toContain('Authored output · Plan');
    expect(result.svg).toContain('Overlay · Plan');
  });
});

function triangleMesh(xOffset: number): ShapeMesh {
  return {
    vertices: new Float32Array([xOffset, 0, 0, xOffset + 1, 0, 0, xOffset, 1, 0]),
    triangles: new Uint32Array([0, 1, 2]),
    normals: new Float32Array(),
    uvs: new Float32Array(),
    faceGroups: [],
  };
}
