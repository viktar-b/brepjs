import type { ShapeMesh } from 'brepjs';

/** Projection-ready geometry kept beside, and independent from, product semantics. */
export type ProductBody =
  { readonly kind: 'ANALYTIC' } | { readonly kind: 'TESSELLATED'; readonly mesh: ShapeMesh };

/** Geometric closure check used at direct BimModel and Families Projection boundaries. */
export function productBodyMeshIsClosed(mesh: ShapeMesh): boolean {
  if (
    mesh.vertices.length < 9 ||
    mesh.vertices.length % 3 !== 0 ||
    mesh.triangles.length < 12 ||
    mesh.triangles.length % 3 !== 0
  ) {
    return false;
  }
  for (const coordinate of mesh.vertices) {
    if (!Number.isFinite(coordinate)) return false;
  }
  const weldedByPoint = new Map<string, number>();
  const weldedPoints: [number, number, number][] = [];
  const sourceToWelded = new Map<number, number>();
  for (let source = 0; source * 3 + 2 < mesh.vertices.length; source++) {
    const offset = source * 3;
    const key = [
      Math.round((mesh.vertices[offset] ?? 0) * 1e7),
      Math.round((mesh.vertices[offset + 1] ?? 0) * 1e7),
      Math.round((mesh.vertices[offset + 2] ?? 0) * 1e7),
    ].join(':');
    let welded = weldedByPoint.get(key);
    if (welded === undefined) {
      welded = weldedByPoint.size;
      weldedByPoint.set(key, welded);
      const x = mesh.vertices[offset];
      const y = mesh.vertices[offset + 1];
      const z = mesh.vertices[offset + 2];
      if (x === undefined || y === undefined || z === undefined) return false;
      weldedPoints.push([x, y, z]);
    }
    sourceToWelded.set(source, welded);
  }
  const edgeUses = new Map<string, { forward: number; reverse: number }>();
  for (let index = 0; index + 2 < mesh.triangles.length; index += 3) {
    const a = sourceToWelded.get(mesh.triangles[index] ?? -1);
    const b = sourceToWelded.get(mesh.triangles[index + 1] ?? -1);
    const c = sourceToWelded.get(mesh.triangles[index + 2] ?? -1);
    if (a === undefined || b === undefined || c === undefined || new Set([a, b, c]).size !== 3) {
      return false;
    }
    const pointA = weldedPoints[a];
    const pointB = weldedPoints[b];
    const pointC = weldedPoints[c];
    if (
      pointA === undefined ||
      pointB === undefined ||
      pointC === undefined ||
      triangleAreaSquared(pointA, pointB, pointC) <= 1e-18
    ) {
      return false;
    }
    for (const [start, end] of [
      [a, b],
      [b, c],
      [c, a],
    ] as const) {
      const key = start < end ? `${start}:${end}` : `${end}:${start}`;
      const use = edgeUses.get(key) ?? { forward: 0, reverse: 0 };
      if (start < end) use.forward++;
      else use.reverse++;
      edgeUses.set(key, use);
    }
  }
  return (
    edgeUses.size > 0 &&
    [...edgeUses.values()].every(({ forward, reverse }) => forward === 1 && reverse === 1)
  );
}

function triangleAreaSquared(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  c: readonly [number, number, number]
): number {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]] as const;
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]] as const;
  const x = ab[1] * ac[2] - ab[2] * ac[1];
  const y = ab[2] * ac[0] - ab[0] * ac[2];
  const z = ab[0] * ac[1] - ab[1] * ac[0];
  return (x * x + y * y + z * z) / 4;
}
