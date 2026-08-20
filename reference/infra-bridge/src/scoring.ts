import type {
  ObservationVector,
  ReconstructionTarget,
  SurfaceObservation,
  Triangle,
} from './contracts.js';
import { referenceHarnessError } from './errors.js';
import type { ReferenceHarnessResult } from './referenceHarness.js';

export interface CandidateScore {
  readonly surfaceDistance: {
    readonly maximumMm: number;
    readonly meanMm: number;
    readonly p95Mm: number;
    readonly areaSampleCount: number;
  };
  readonly normalAgreement: {
    readonly meanCosine: number;
    readonly minimumCosine: number;
  };
  readonly envelope: {
    readonly deltasMm: EnvelopeDeltas;
    readonly maximumAbsoluteDeltaMm: number;
  };
  readonly volume?:
    | {
        readonly targetMm3: number;
        readonly candidateMm3: number;
        readonly relativeError: number;
      }
    | undefined;
  readonly closedSolidIoU?:
    { readonly value: number; readonly method: 'exact-envelope' | 'voxel-32' } | undefined;
}

export interface EnvelopeDeltas {
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
  readonly zMin: number;
  readonly zMax: number;
}

interface PreparedSurface {
  readonly vertices: readonly ObservationVector[];
  readonly triangles: readonly Triangle[];
  readonly closed: boolean;
}

interface Bounds {
  readonly min: ObservationVector;
  readonly max: ObservationVector;
}

interface TriangleGeometry {
  readonly a: ObservationVector;
  readonly b: ObservationVector;
  readonly c: ObservationVector;
  readonly normal: ObservationVector;
  readonly centroid: ObservationVector;
  readonly area: number;
  readonly bounds: Bounds;
}

interface SpatialNode {
  readonly bounds: Bounds;
  readonly triangles?: readonly TriangleGeometry[];
  readonly left?: SpatialNode;
  readonly right?: SpatialNode;
}

interface SurfaceComparison {
  readonly distances: readonly number[];
  readonly normalCosines: readonly number[];
  readonly maximumDistance: number;
}

const AREA_SAMPLE_BUDGET = 2_048;
const MAX_VERTEX_EXTREME_SAMPLES = 4_096;
const SPATIAL_LEAF_SIZE = 8;

/** Compare evaluated authored geometry to one source-neutral target in physical millimetres. */
export function scoreCandidate(
  target: ReconstructionTarget,
  candidate: SurfaceObservation
): ReferenceHarnessResult<CandidateScore> {
  try {
    const preparedTarget = prepareSurface(target.comparisonSurface, 'reference');
    if (!preparedTarget.ok) return preparedTarget;
    const preparedCandidate = prepareSurface(candidate, 'candidate');
    if (!preparedCandidate.ok) return preparedCandidate;

    const targetTriangles = triangleGeometry(preparedTarget.value);
    const candidateTriangles = triangleGeometry(preparedCandidate.value);
    const targetIndex = buildSpatialIndex(targetTriangles);
    const candidateIndex = buildSpatialIndex(candidateTriangles);
    const targetToCandidate = compareSurface(preparedTarget.value, targetTriangles, candidateIndex);
    const candidateToTarget = compareSurface(
      preparedCandidate.value,
      candidateTriangles,
      targetIndex
    );
    const distances = [...targetToCandidate.distances, ...candidateToTarget.distances];
    const normalCosines = [...targetToCandidate.normalCosines, ...candidateToTarget.normalCosines];
    const targetBounds = bounds(preparedTarget.value.vertices);
    const candidateBounds = bounds(preparedCandidate.value.vertices);
    const deltasMm: EnvelopeDeltas = {
      xMin: clean(candidateBounds.min[0] - targetBounds.min[0]),
      xMax: clean(candidateBounds.max[0] - targetBounds.max[0]),
      yMin: clean(candidateBounds.min[1] - targetBounds.min[1]),
      yMax: clean(candidateBounds.max[1] - targetBounds.max[1]),
      zMin: clean(candidateBounds.min[2] - targetBounds.min[2]),
      zMax: clean(candidateBounds.max[2] - targetBounds.max[2]),
    };

    const closed = preparedTarget.value.closed && preparedCandidate.value.closed;
    const targetVolume = closed ? meshVolume(preparedTarget.value) : undefined;
    const candidateVolume = closed ? meshVolume(preparedCandidate.value) : undefined;
    const volume =
      targetVolume === undefined || candidateVolume === undefined || targetVolume <= 1e-12
        ? undefined
        : {
            targetMm3: clean(targetVolume),
            candidateMm3: clean(candidateVolume),
            relativeError: clean(Math.abs(candidateVolume - targetVolume) / targetVolume),
          };
    const iou =
      targetVolume === undefined || candidateVolume === undefined || volume === undefined
        ? undefined
        : closedSolidIoU(
            preparedTarget.value,
            preparedCandidate.value,
            targetBounds,
            candidateBounds,
            targetVolume,
            candidateVolume
          );

    return {
      ok: true,
      value: {
        surfaceDistance: {
          maximumMm: clean(
            Math.max(targetToCandidate.maximumDistance, candidateToTarget.maximumDistance)
          ),
          meanMm: clean(mean(distances)),
          p95Mm: clean(percentile(distances, 0.95)),
          areaSampleCount: distances.length,
        },
        normalAgreement: {
          meanCosine: clean(mean(normalCosines)),
          minimumCosine: clean(minimum(normalCosines)),
        },
        envelope: {
          deltasMm,
          maximumAbsoluteDeltaMm: clean(
            maximum(Object.values(deltasMm).map((value) => Math.abs(value)))
          ),
        },
        ...(volume === undefined ? {} : { volume }),
        ...(iou === undefined ? {} : { closedSolidIoU: iou }),
      },
    };
  } catch (cause) {
    return {
      ok: false,
      error: referenceHarnessError(
        'SCORING_FAILURE',
        'The Reference Harness scorer could not evaluate the prepared comparison surfaces',
        { source: 'scoring', cause: errorMessage(cause) }
      ),
    };
  }
}

function prepareSurface(
  surface: SurfaceObservation,
  source: 'reference' | 'candidate'
): ReferenceHarnessResult<PreparedSurface> {
  if (!hasMillimetreUnit(surface) || surface.vertices.length < 3 || surface.triangles.length < 1) {
    return invalidSurface('Comparison surface must contain physical-mm triangle geometry', source);
  }
  const vertices: ObservationVector[] = [];
  const indexByPoint = new Map<string, number>();
  const sourceToWelded = new Map<number, number>();
  for (let sourceIndex = 0; sourceIndex < surface.vertices.length; sourceIndex++) {
    const point = surface.vertices[sourceIndex];
    if (point === undefined || point.some((value) => !Number.isFinite(value))) {
      return invalidSurface('Comparison surface contains a non-finite vertex', source);
    }
    const key = point.map((value) => Math.round(value * 1e7)).join(':');
    let weldedIndex = indexByPoint.get(key);
    if (weldedIndex === undefined) {
      weldedIndex = vertices.length;
      vertices.push(point);
      indexByPoint.set(key, weldedIndex);
    }
    sourceToWelded.set(sourceIndex, weldedIndex);
  }
  const triangles: Triangle[] = [];
  for (const sourceTriangle of surface.triangles) {
    const a = sourceToWelded.get(sourceTriangle[0]);
    const b = sourceToWelded.get(sourceTriangle[1]);
    const c = sourceToWelded.get(sourceTriangle[2]);
    if (a === undefined || b === undefined || c === undefined || new Set([a, b, c]).size !== 3) {
      return invalidSurface(
        'Comparison surface contains invalid or degenerate triangle indices',
        source
      );
    }
    const triangle: Triangle = [a, b, c];
    if (triangleNormal(vertices, triangle) === null) {
      return invalidSurface('Comparison surface contains a zero-area triangle', source);
    }
    triangles.push(triangle);
  }
  if (surface.closed && !isClosedTopology(triangles)) {
    return invalidSurface(
      'A closed comparison surface must be a two-manifold triangle shell',
      source
    );
  }
  return { ok: true, value: { vertices, triangles, closed: surface.closed } };
}

function hasMillimetreUnit(value: unknown): boolean {
  return (
    typeof value === 'object' && value !== null && 'unit' in value && value.unit === 'millimetre'
  );
}

function triangleGeometry(surface: PreparedSurface): TriangleGeometry[] {
  return surface.triangles.map((triangle) => {
    const a = vertex(surface, triangle[0]);
    const b = vertex(surface, triangle[1]);
    const c = vertex(surface, triangle[2]);
    const normal = triangleNormal(surface.vertices, triangle);
    if (normal === null) throw new Error('degenerate triangle after validation');
    const crossProduct = cross(subtract(b, a), subtract(c, a));
    return {
      a,
      b,
      c,
      normal,
      centroid: scale(add(add(a, b), c), 1 / 3),
      area: length(crossProduct) / 2,
      bounds: bounds([a, b, c]),
    };
  });
}

function compareSurface(
  surface: PreparedSurface,
  sourceTriangles: readonly TriangleGeometry[],
  targetIndex: SpatialNode
): SurfaceComparison {
  const distances: number[] = [];
  const normalCosines: number[] = [];
  let maximumDistance = 0;
  for (const sample of areaSamples(sourceTriangles, AREA_SAMPLE_BUDGET)) {
    const nearest = nearestTriangle(sample.point, targetIndex);
    distances.push(nearest.distance);
    normalCosines.push(Math.max(-1, Math.min(1, dot(sample.normal, nearest.triangle.normal))));
    maximumDistance = Math.max(maximumDistance, nearest.distance);
  }
  for (const point of boundedSamples(surface.vertices, MAX_VERTEX_EXTREME_SAMPLES)) {
    maximumDistance = Math.max(maximumDistance, nearestTriangle(point, targetIndex).distance);
  }
  return { distances, normalCosines, maximumDistance };
}

function areaSamples(
  triangles: readonly TriangleGeometry[],
  budget: number
): readonly { readonly point: ObservationVector; readonly normal: ObservationVector }[] {
  const totalArea = triangles.reduce((sum, triangle) => sum + triangle.area, 0);
  if (!(totalArea > 0)) throw new Error('surface has no measurable area');
  const cumulative: number[] = [];
  let area = 0;
  for (const triangle of triangles) {
    area += triangle.area;
    cumulative.push(area);
  }
  const samples: { point: ObservationVector; normal: ObservationVector }[] = [];
  let triangleIndex = 0;
  for (let sampleIndex = 0; sampleIndex < budget; sampleIndex++) {
    const targetArea = ((sampleIndex + 0.5) / budget) * totalArea;
    while (
      triangleIndex + 1 < cumulative.length &&
      (cumulative[triangleIndex] ?? Infinity) < targetArea
    ) {
      triangleIndex++;
    }
    const triangle = triangles[triangleIndex];
    if (triangle === undefined) throw new Error('area sampler selected no triangle');
    // A deterministic low-discrepancy barycentric point avoids triangle-centroid bias.
    const u = radicalInverse(sampleIndex + 1, 2);
    const v = radicalInverse(sampleIndex + 1, 3);
    const rootU = Math.sqrt(u);
    const point = add(
      scale(triangle.a, 1 - rootU),
      add(scale(triangle.b, rootU * (1 - v)), scale(triangle.c, rootU * v))
    );
    samples.push({ point, normal: triangle.normal });
  }
  return samples;
}

function radicalInverse(index: number, base: number): number {
  let result = 0;
  let factor = 1 / base;
  let remaining = index;
  while (remaining > 0) {
    result += (remaining % base) * factor;
    remaining = Math.floor(remaining / base);
    factor /= base;
  }
  return result;
}

function boundedSamples<T>(values: readonly T[], maximumCount: number): readonly T[] {
  if (values.length <= maximumCount) return values;
  const samples: T[] = [];
  for (let index = 0; index < maximumCount; index++) {
    const sourceIndex = Math.floor((index * values.length) / maximumCount);
    const value = values[sourceIndex];
    if (value !== undefined) samples.push(value);
  }
  return samples;
}

function pointTriangleDistance(point: ObservationVector, triangle: TriangleGeometry): number {
  const { a, b, c } = triangle;
  const ab = subtract(b, a);
  const ac = subtract(c, a);
  const ap = subtract(point, a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return length(ap);
  const bp = subtract(point, b);
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return length(bp);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return distance(point, add(a, scale(ab, v)));
  }
  const cp = subtract(point, c);
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return length(cp);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return distance(point, add(a, scale(ac, w)));
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + d5 - d6);
    return distance(point, add(b, scale(subtract(c, b), w)));
  }
  return Math.abs(dot(ap, triangle.normal));
}

function buildSpatialIndex(triangles: readonly TriangleGeometry[]): SpatialNode {
  if (triangles.length === 0) throw new Error('cannot index an empty triangle surface');
  const nodeBounds = mergeBounds(triangles.map(({ bounds: triangleBounds }) => triangleBounds));
  if (triangles.length <= SPATIAL_LEAF_SIZE) return { bounds: nodeBounds, triangles };
  const span: ObservationVector = [
    nodeBounds.max[0] - nodeBounds.min[0],
    nodeBounds.max[1] - nodeBounds.min[1],
    nodeBounds.max[2] - nodeBounds.min[2],
  ];
  const axis = span[0] >= span[1] && span[0] >= span[2] ? 0 : span[1] >= span[2] ? 1 : 2;
  const ordered = [...triangles].sort((left, right) => left.centroid[axis] - right.centroid[axis]);
  const middle = Math.floor(ordered.length / 2);
  return {
    bounds: nodeBounds,
    left: buildSpatialIndex(ordered.slice(0, middle)),
    right: buildSpatialIndex(ordered.slice(middle)),
  };
}

function nearestTriangle(
  point: ObservationVector,
  root: SpatialNode
): { readonly distance: number; readonly triangle: TriangleGeometry } {
  let bestDistance = Infinity;
  let bestTriangle: TriangleGeometry | undefined;
  const visit = (node: SpatialNode): void => {
    if (pointBoundsDistance(point, node.bounds) > bestDistance) return;
    if (node.triangles !== undefined) {
      for (const triangle of node.triangles) {
        const triangleDistance = pointTriangleDistance(point, triangle);
        if (triangleDistance < bestDistance) {
          bestDistance = triangleDistance;
          bestTriangle = triangle;
        }
      }
      return;
    }
    const left = node.left;
    const right = node.right;
    if (left === undefined || right === undefined) throw new Error('malformed spatial index');
    const leftDistance = pointBoundsDistance(point, left.bounds);
    const rightDistance = pointBoundsDistance(point, right.bounds);
    if (leftDistance <= rightDistance) {
      visit(left);
      visit(right);
    } else {
      visit(right);
      visit(left);
    }
  };
  visit(root);
  if (bestTriangle === undefined) throw new Error('spatial index contains no triangle');
  return { distance: bestDistance, triangle: bestTriangle };
}

function pointBoundsDistance(point: ObservationVector, value: Bounds): number {
  let squared = 0;
  for (const axis of [0, 1, 2] as const) {
    const coordinate = point[axis];
    const below = value.min[axis] - coordinate;
    const above = coordinate - value.max[axis];
    const outside = below > 0 ? below : above > 0 ? above : 0;
    squared += outside * outside;
  }
  return Math.sqrt(squared);
}

function mergeBounds(values: readonly Bounds[]): Bounds {
  if (values.length === 0) throw new Error('cannot merge no bounds');
  const points: ObservationVector[] = [];
  for (const value of values) points.push(value.min, value.max);
  return bounds(points);
}

function closedSolidIoU(
  target: PreparedSurface,
  candidate: PreparedSurface,
  targetBounds: Bounds,
  candidateBounds: Bounds,
  targetVolume: number,
  candidateVolume: number
): CandidateScore['closedSolidIoU'] {
  if (
    almostEqual(targetVolume, envelopeVolume(targetBounds)) &&
    almostEqual(candidateVolume, envelopeVolume(candidateBounds))
  ) {
    const intersection = intersectionVolume(targetBounds, candidateBounds);
    return {
      value: clean(intersection / (targetVolume + candidateVolume - intersection)),
      method: 'exact-envelope',
    };
  }

  const combined: Bounds = {
    min: [
      Math.min(targetBounds.min[0], candidateBounds.min[0]),
      Math.min(targetBounds.min[1], candidateBounds.min[1]),
      Math.min(targetBounds.min[2], candidateBounds.min[2]),
    ],
    max: [
      Math.max(targetBounds.max[0], candidateBounds.max[0]),
      Math.max(targetBounds.max[1], candidateBounds.max[1]),
      Math.max(targetBounds.max[2], candidateBounds.max[2]),
    ],
  };
  const targetIndex = buildSpatialIndex(triangleGeometry(target));
  const candidateIndex = buildSpatialIndex(triangleGeometry(candidate));
  let intersection = 0;
  let union = 0;
  const resolution = 32;
  for (let x = 0; x < resolution; x++) {
    for (let y = 0; y < resolution; y++) {
      for (let z = 0; z < resolution; z++) {
        const point: ObservationVector = [
          combined.min[0] + ((x + 0.5) / resolution) * (combined.max[0] - combined.min[0]),
          combined.min[1] + ((y + 0.5) / resolution) * (combined.max[1] - combined.min[1]),
          combined.min[2] + ((z + 0.5) / resolution) * (combined.max[2] - combined.min[2]),
        ];
        const inTarget = pointInside(point, targetIndex);
        const inCandidate = pointInside(point, candidateIndex);
        if (inTarget || inCandidate) union++;
        if (inTarget && inCandidate) intersection++;
      }
    }
  }
  return { value: union === 0 ? 0 : intersection / union, method: 'voxel-32' };
}

function pointInside(point: ObservationVector, root: SpatialNode): boolean {
  const direction = normalize([1, 0.371, 0.529]);
  if (direction === null) return false;
  const intersections: number[] = [];
  const visit = (node: SpatialNode): void => {
    if (!rayIntersectsBounds(point, direction, node.bounds)) return;
    if (node.triangles !== undefined) {
      for (const triangle of node.triangles) {
        const hit = rayTriangleDistance(point, direction, triangle);
        if (hit !== null) intersections.push(hit);
      }
      return;
    }
    if (node.left !== undefined) visit(node.left);
    if (node.right !== undefined) visit(node.right);
  };
  visit(root);
  intersections.sort((left, right) => left - right);
  let unique = 0;
  let previous = -Infinity;
  for (const hit of intersections) {
    if (Math.abs(hit - previous) > 1e-8 * Math.max(1, Math.abs(hit))) {
      unique++;
      previous = hit;
    }
  }
  return unique % 2 === 1;
}

function rayIntersectsBounds(
  origin: ObservationVector,
  direction: ObservationVector,
  value: Bounds
): boolean {
  let minimumT = 0;
  let maximumT = Infinity;
  for (const axis of [0, 1, 2] as const) {
    const axisDirection = direction[axis];
    const axisOrigin = origin[axis];
    const minimum = value.min[axis];
    const maximum = value.max[axis];
    if (Math.abs(axisDirection) < 1e-12) {
      if (axisOrigin < minimum || axisOrigin > maximum) return false;
      continue;
    }
    let first = (minimum - axisOrigin) / axisDirection;
    let second = (maximum - axisOrigin) / axisDirection;
    if (first > second) [first, second] = [second, first];
    minimumT = Math.max(minimumT, first);
    maximumT = Math.min(maximumT, second);
    if (maximumT < minimumT) return false;
  }
  return maximumT > 1e-9;
}

function rayTriangleDistance(
  origin: ObservationVector,
  direction: ObservationVector,
  triangle: TriangleGeometry
): number | null {
  const edge1 = subtract(triangle.b, triangle.a);
  const edge2 = subtract(triangle.c, triangle.a);
  const h = cross(direction, edge2);
  const determinant = dot(edge1, h);
  if (Math.abs(determinant) < 1e-10) return null;
  const inverse = 1 / determinant;
  const s = subtract(origin, triangle.a);
  const u = inverse * dot(s, h);
  if (u < 0 || u > 1) return null;
  const q = cross(s, edge1);
  const v = inverse * dot(direction, q);
  if (v < 0 || u + v > 1) return null;
  const t = inverse * dot(edge2, q);
  return t > 1e-9 ? t : null;
}

function isClosedTopology(triangles: readonly Triangle[]): boolean {
  const uses = new Map<string, { forward: number; reverse: number }>();
  for (const [a, b, c] of triangles) {
    for (const [start, end] of [
      [a, b],
      [b, c],
      [c, a],
    ] as const) {
      const key = start < end ? `${start}:${end}` : `${end}:${start}`;
      const use = uses.get(key) ?? { forward: 0, reverse: 0 };
      if (start < end) use.forward++;
      else use.reverse++;
      uses.set(key, use);
    }
  }
  return (
    uses.size > 0 &&
    [...uses.values()].every(({ forward, reverse }) => forward === 1 && reverse === 1)
  );
}

function triangleNormal(
  vertices: readonly ObservationVector[],
  [a, b, c]: Triangle
): ObservationVector | null {
  return normalize(
    cross(
      subtract(vertexFrom(vertices, b), vertexFrom(vertices, a)),
      subtract(vertexFrom(vertices, c), vertexFrom(vertices, a))
    )
  );
}

function meshVolume(surface: PreparedSurface): number {
  let signed = 0;
  for (const [a, b, c] of surface.triangles) {
    signed += dot(vertex(surface, a), cross(vertex(surface, b), vertex(surface, c))) / 6;
  }
  return Math.abs(signed);
}

function bounds(vertices: readonly ObservationVector[]): Bounds {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const point of vertices) {
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis] ?? Infinity, point[axis] ?? Infinity);
      max[axis] = Math.max(max[axis] ?? -Infinity, point[axis] ?? -Infinity);
    }
  }
  return { min, max };
}

function envelopeVolume(value: Bounds): number {
  return (
    (value.max[0] - value.min[0]) * (value.max[1] - value.min[1]) * (value.max[2] - value.min[2])
  );
}

function intersectionVolume(left: Bounds, right: Bounds): number {
  return (
    Math.max(0, Math.min(left.max[0], right.max[0]) - Math.max(left.min[0], right.min[0])) *
    Math.max(0, Math.min(left.max[1], right.max[1]) - Math.max(left.min[1], right.min[1])) *
    Math.max(0, Math.min(left.max[2], right.max[2]) - Math.max(left.min[2], right.min[2]))
  );
}

function vertex(surface: PreparedSurface, index: number): ObservationVector {
  return vertexFrom(surface.vertices, index);
}

function vertexFrom(vertices: readonly ObservationVector[], index: number): ObservationVector {
  const value = vertices[index];
  if (value === undefined) throw new Error('triangle index outside vertex list');
  return value;
}

function add(left: ObservationVector, right: ObservationVector): ObservationVector {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

function subtract(left: ObservationVector, right: ObservationVector): ObservationVector {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function scale(vector: ObservationVector, factor: number): ObservationVector {
  return [vector[0] * factor, vector[1] * factor, vector[2] * factor];
}

function cross(left: ObservationVector, right: ObservationVector): ObservationVector {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function normalize(vector: ObservationVector): ObservationVector | null {
  const magnitude = length(vector);
  return magnitude < 1e-12 ? null : scale(vector, 1 / magnitude);
}

function dot(left: ObservationVector, right: ObservationVector): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function length(vector: ObservationVector): number {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

function distance(left: ObservationVector, right: ObservationVector): number {
  return length(subtract(left, right));
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) throw new Error('cannot calculate percentile of no values');
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  const value = sorted[index];
  if (value === undefined) throw new Error('percentile index outside values');
  return value;
}

function minimum(values: readonly number[]): number {
  if (values.length === 0) throw new Error('cannot calculate minimum of no values');
  let result = Infinity;
  for (const value of values) result = Math.min(result, value);
  return result;
}

function maximum(values: readonly number[]): number {
  if (values.length === 0) throw new Error('cannot calculate maximum of no values');
  let result = -Infinity;
  for (const value of values) result = Math.max(result, value);
  return result;
}

function almostEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= 1e-8 * Math.max(1, Math.abs(left), Math.abs(right));
}

function clean(value: number): number {
  if (Math.abs(value) < 1e-10) return 0;
  if (Math.abs(value - 1) < 1e-10) return 1;
  if (Math.abs(value + 1) < 1e-10) return -1;
  return value;
}

function invalidSurface(
  message: string,
  source: 'reference' | 'candidate'
): ReferenceHarnessResult<never> {
  return {
    ok: false,
    error: referenceHarnessError('INVALID_TOPOLOGY', message, { source }),
  };
}

function errorMessage(cause: unknown): string {
  try {
    return cause instanceof Error ? cause.message : String(cause);
  } catch {
    return 'Unknown scoring failure';
  }
}
