import * as WebIFC from 'web-ifc';
import type { ObservationVector, Triangle } from './contracts.js';
import {
  arrayValue,
  booleanValue,
  cross,
  failure,
  normalize,
  numberList,
  numericValue,
  readAxisPlacement3D,
  refValue,
  scaleVector,
  success,
  type DecodeResult,
  type IfcReferenceReader,
  type RepresentationDecoder,
} from './ifcReferenceAdapter.js';

interface EdgeRecord {
  readonly id: number;
  readonly startId: number;
  readonly endId: number;
  readonly start: ObservationVector;
  readonly end: ObservationVector;
  readonly lineDirection: ObservationVector;
}

interface DirectedEdge {
  readonly edge: EdgeRecord;
  readonly startId: number;
  readonly endId: number;
}

interface DecodedFace {
  readonly loopVertexIds: readonly number[];
  readonly loopEdgeIds: readonly number[];
  readonly planePoint: ObservationVector;
  readonly planeNormal: ObservationVector;
}

/** Internal deterministic Adapter for one complete planar IfcAdvancedBrep item. */
export const analyticBrepRepresentationDecoder: RepresentationDecoder = {
  itemType: WebIFC.IFCADVANCEDBREP,
  decode(context) {
    const { reader, itemId, semanticKey, millimetresPerFileUnit } = context;
    const brep = reader.getLine(itemId);
    const shellId = refValue(brep?.['Outer']);
    if (shellId === null || reader.lineType(shellId) !== WebIFC.IFCCLOSEDSHELL) {
      return invalidTopology(semanticKey, 'Advanced B-Rep has no closed outer shell');
    }
    const shell = reader.getLine(shellId);
    const faceIds = references(shell?.['CfsFaces']);
    if (faceIds.length === 0) return openTopology(semanticKey);

    const vertices = new Map<number, ObservationVector>();
    const edges = new Map<number, EdgeRecord>();
    const edgeUses = new Map<number, DirectedEdge[]>();
    const faces: DecodedFace[] = [];
    for (const faceId of faceIds) {
      const face = decodeFace(
        reader,
        faceId,
        semanticKey,
        millimetresPerFileUnit,
        vertices,
        edges,
        edgeUses
      );
      if (!face.ok) return face;
      faces.push(face.value);
    }

    for (const uses of edgeUses.values()) {
      if (
        uses.length !== 2 ||
        uses[0]?.startId !== uses[1]?.endId ||
        uses[0]?.endId !== uses[1]?.startId
      ) {
        return openTopology(semanticKey);
      }
    }
    if (edges.size === 0 || [...edges.keys()].some((edgeId) => !edgeUses.has(edgeId))) {
      return openTopology(semanticKey);
    }
    if (vertices.size !== 8 || edges.size !== 12 || faces.length !== 6) {
      return unsupported(
        semanticKey,
        'The first analytic B-Rep lane accepts only a six-face rectangular solid'
      );
    }

    const sortedVertices = [...vertices.entries()].sort((left, right) =>
      compareVectors(left[1], right[1])
    );
    const indexByVertexId = new Map<number, number>();
    sortedVertices.forEach(([vertexId], index) => indexByVertexId.set(vertexId, index));
    const sortedEdges = [...edges.values()].sort((left, right) => left.id - right.id);
    const indexByEdgeId = new Map<number, number>();
    sortedEdges.forEach(({ id }, index) => indexByEdgeId.set(id, index));
    const triangles: Triangle[] = [];
    for (const face of faces) {
      for (let index = 1; index + 1 < face.loopVertexIds.length; index++) {
        const a = indexByVertexId.get(face.loopVertexIds[0] ?? -1);
        const b = indexByVertexId.get(face.loopVertexIds[index] ?? -1);
        const c = indexByVertexId.get(face.loopVertexIds[index + 1] ?? -1);
        if (
          a === undefined ||
          b === undefined ||
          c === undefined ||
          new Set([a, b, c]).size !== 3
        ) {
          return invalidTopology(semanticKey, 'Advanced face triangulation is degenerate');
        }
        triangles.push([a, b, c]);
      }
    }

    const points = sortedVertices.map(([, point]) => point);
    const envelope = dimensions(points);
    if (envelope === null) return invalidTopology(semanticKey, 'Advanced B-Rep has no volume');
    const topologyEdges = sortedEdges.map(({ startId, endId }) => ({
      vertices: [indexByVertexId.get(startId) ?? -1, indexByVertexId.get(endId) ?? -1] as const,
    }));
    const topologyFaces = faces.map(({ loopVertexIds, loopEdgeIds }) => ({
      vertices: loopVertexIds.map((vertexId) => indexByVertexId.get(vertexId) ?? -1),
      edges: loopEdgeIds.map((edgeId) => indexByEdgeId.get(edgeId) ?? -1),
    }));
    if (
      topologyEdges.some(({ vertices: [start, end] }) => start < 0 || end < 0) ||
      topologyFaces.some(
        ({ vertices: faceVertices, edges: faceEdges }) =>
          faceVertices.some((index) => index < 0) || faceEdges.some((index) => index < 0)
      )
    ) {
      return invalidTopology(semanticKey, 'Advanced B-Rep adjacency is inconsistent');
    }
    return success({
      comparisonSurface: {
        unit: 'millimetre',
        vertices: points,
        triangles,
        closed: true,
      },
      dimensions: [
        { name: 'envelope-x', value: envelope[0], unit: 'millimetre' },
        { name: 'envelope-y', value: envelope[1], unit: 'millimetre' },
        { name: 'envelope-z', value: envelope[2], unit: 'millimetre' },
      ],
      analyticEvidence: {
        surfaces: faces.map(({ planePoint, planeNormal }) => ({
          kind: 'plane',
          point: planePoint,
          normal: planeNormal,
        })),
        curves: sortedEdges.map(({ start, end, lineDirection }) => ({
          kind: 'line',
          point: start,
          direction: lineDirection,
          start,
          end,
        })),
        topology: {
          vertexCount: vertices.size,
          edgeCount: edges.size,
          faceCount: faces.length,
          closed: true,
          vertices: points,
          edges: topologyEdges,
          faces: topologyFaces,
        },
      },
    });
  },
};

function decodeFace(
  reader: IfcReferenceReader,
  faceId: number,
  semanticKey: string,
  scale: number,
  vertices: Map<number, ObservationVector>,
  edges: Map<number, EdgeRecord>,
  edgeUses: Map<number, DirectedEdge[]>
): DecodeResult<DecodedFace> {
  if (reader.lineType(faceId) !== WebIFC.IFCADVANCEDFACE) {
    return unsupported(semanticKey, 'The closed shell contains a non-advanced face');
  }
  const face = reader.getLine(faceId);
  const boundIds = references(face?.['Bounds']);
  if (boundIds.length !== 1) {
    return unsupported(semanticKey, 'Holed or missing advanced face bounds are not supported');
  }
  const boundId = boundIds[0];
  if (boundId === undefined || reader.lineType(boundId) !== WebIFC.IFCFACEOUTERBOUND) {
    return unsupported(semanticKey, 'Only one outer edge-loop bound is supported');
  }
  const bound = reader.getLine(boundId);
  const boundOrientation = booleanValue(bound?.['Orientation']);
  const loopId = refValue(bound?.['Bound']);
  if (
    boundOrientation === null ||
    loopId === null ||
    reader.lineType(loopId) !== WebIFC.IFCEDGELOOP
  ) {
    return invalidTopology(semanticKey, 'Advanced face outer bound is malformed');
  }
  const loop = reader.getLine(loopId);
  const orientedEdgeIds = references(loop?.['EdgeList']);
  if (orientedEdgeIds.length < 3) {
    return invalidTopology(semanticKey, 'Advanced face edge loop is degenerate');
  }

  const directed: DirectedEdge[] = [];
  for (const orientedEdgeId of orientedEdgeIds) {
    if (reader.lineType(orientedEdgeId) !== WebIFC.IFCORIENTEDEDGE) {
      return invalidTopology(semanticKey, 'Edge loop contains a non-oriented edge');
    }
    const oriented = reader.getLine(orientedEdgeId);
    const edgeId = refValue(oriented?.['EdgeElement']);
    const orientation = booleanValue(oriented?.['Orientation']);
    if (edgeId === null || orientation === null) {
      return invalidTopology(semanticKey, 'Oriented edge is malformed');
    }
    let edge = edges.get(edgeId);
    if (edge === undefined) {
      const decoded = decodeEdge(reader, edgeId, semanticKey, scale, vertices);
      if (!decoded.ok) return decoded;
      edge = decoded.value;
      edges.set(edgeId, edge);
    }
    directed.push({
      edge,
      startId: orientation ? edge.startId : edge.endId,
      endId: orientation ? edge.endId : edge.startId,
    });
  }

  const orientedLoop = boundOrientation
    ? directed
    : [...directed]
        .reverse()
        .map(({ edge, startId, endId }) => ({ edge, startId: endId, endId: startId }));
  for (let index = 0; index < orientedLoop.length; index++) {
    const current = orientedLoop[index];
    const next = orientedLoop[(index + 1) % orientedLoop.length];
    if (current === undefined || next === undefined || current.endId !== next.startId) {
      return invalidTopology(semanticKey, 'Oriented edge loop is not continuous');
    }
    const uses = edgeUses.get(current.edge.id) ?? [];
    uses.push(current);
    edgeUses.set(current.edge.id, uses);
  }

  const loopVertexIds = orientedLoop.map(({ startId }) => startId);
  const loopPoints = loopVertexIds.map((vertexId) => vertices.get(vertexId));
  if (loopPoints.some((point) => point === undefined)) {
    return invalidTopology(semanticKey, 'Edge loop references a missing vertex');
  }
  const first = loopPoints[0];
  const second = loopPoints[1];
  const third = loopPoints[2];
  if (first === undefined || second === undefined || third === undefined) {
    return invalidTopology(semanticKey, 'Advanced face has too few vertices');
  }
  const topologyNormal = normalize(cross(subtract(second, first), subtract(third, first)));
  if (topologyNormal === null) return invalidTopology(semanticKey, 'Advanced face is degenerate');

  const surfaceId = refValue(face?.['FaceSurface']);
  if (surfaceId === null || reader.lineType(surfaceId) !== WebIFC.IFCPLANE) {
    return unsupported(semanticKey, 'The analytic B-Rep lane supports planar faces only');
  }
  const plane = reader.getLine(surfaceId);
  const positionId = refValue(plane?.['Position']);
  const position = positionId === null ? null : readAxisPlacement3D(reader, positionId, scale);
  const sameSense = booleanValue(face?.['SameSense']);
  if (position === null || sameSense === null) {
    return invalidTopology(semanticKey, 'Advanced face plane is malformed');
  }
  const rawPlaneNormal: ObservationVector = [position[8], position[9], position[10]];
  const planeNormal = sameSense ? rawPlaneNormal : negate(rawPlaneNormal);
  const planePoint: ObservationVector = [position[12], position[13], position[14]];
  if (dot(planeNormal, topologyNormal) < 1 - 1e-9) {
    return invalidTopology(semanticKey, 'Advanced face plane sense disagrees with its topology');
  }
  for (const point of loopPoints) {
    if (point === undefined || Math.abs(dot(subtract(point, planePoint), planeNormal)) > 1e-7) {
      return invalidTopology(semanticKey, 'Advanced face vertices do not lie on its plane');
    }
  }
  if (!isRectangularConvexLoop(loopPoints, planeNormal)) {
    return unsupported(
      semanticKey,
      'Concave, self-intersecting, or non-rectangular advanced faces are not supported'
    );
  }
  return success({
    loopVertexIds,
    loopEdgeIds: orientedLoop.map(({ edge }) => edge.id),
    planePoint,
    planeNormal,
  });
}

function isRectangularConvexLoop(
  points: readonly (ObservationVector | undefined)[],
  planeNormal: ObservationVector
): boolean {
  if (points.length !== 4 || points.some((point) => point === undefined)) return false;
  const concrete = points.filter((point): point is ObservationVector => point !== undefined);
  const sides: ObservationVector[] = [];
  for (let index = 0; index < concrete.length; index++) {
    const current = concrete[index];
    const next = concrete[(index + 1) % concrete.length];
    if (current === undefined || next === undefined) return false;
    const side = subtract(next, current);
    if (distance(current, next) < 1e-9) return false;
    sides.push(side);
  }
  for (let index = 0; index < sides.length; index++) {
    const current = sides[index];
    const next = sides[(index + 1) % sides.length];
    if (current === undefined || next === undefined) return false;
    const tolerance = 1e-9 * Math.max(1, distance([0, 0, 0], current) * distance([0, 0, 0], next));
    if (Math.abs(dot(current, next)) > tolerance) return false;
    if (dot(cross(current, next), planeNormal) <= tolerance) return false;
  }
  return true;
}

function decodeEdge(
  reader: IfcReferenceReader,
  edgeId: number,
  semanticKey: string,
  scale: number,
  vertices: Map<number, ObservationVector>
): DecodeResult<EdgeRecord> {
  if (reader.lineType(edgeId) !== WebIFC.IFCEDGECURVE) {
    return invalidTopology(semanticKey, 'Oriented edge does not reference an edge curve');
  }
  const edge = reader.getLine(edgeId);
  const startId = refValue(edge?.['EdgeStart']);
  const endId = refValue(edge?.['EdgeEnd']);
  const geometryId = refValue(edge?.['EdgeGeometry']);
  const sameSense = booleanValue(edge?.['SameSense']);
  if (startId === null || endId === null || geometryId === null || sameSense === null) {
    return invalidTopology(semanticKey, 'Edge curve is malformed');
  }
  const start = readVertex(reader, startId, scale);
  const end = readVertex(reader, endId, scale);
  if (start === null || end === null || distance(start, end) < 1e-9) {
    return invalidTopology(semanticKey, 'Edge curve vertices are invalid');
  }
  vertices.set(startId, start);
  vertices.set(endId, end);

  if (reader.lineType(geometryId) !== WebIFC.IFCLINE) {
    return unsupported(semanticKey, 'The analytic B-Rep lane supports line edges only');
  }
  const line = reader.getLine(geometryId);
  const vectorId = refValue(line?.['Dir']);
  const pointId = refValue(line?.['Pnt']);
  if (vectorId === null || pointId === null || reader.lineType(vectorId) !== WebIFC.IFCVECTOR) {
    return invalidTopology(semanticKey, 'Edge line is malformed');
  }
  const vector = reader.getLine(vectorId);
  const orientationId = refValue(vector?.['Orientation']);
  const magnitude = numericValue(vector?.['Magnitude']);
  const rawDirection = orientationId === null ? null : readDirection(reader, orientationId);
  const linePoint = readCartesianPoint(reader, pointId, scale);
  if (rawDirection === null || linePoint === null || magnitude === null || magnitude <= 0) {
    return invalidTopology(semanticKey, 'Edge line direction is invalid');
  }
  const lineDirection = sameSense ? rawDirection : negate(rawDirection);
  const edgeDirection = normalize(subtract(end, start));
  if (
    edgeDirection === null ||
    dot(lineDirection, edgeDirection) < 1 - 1e-9 ||
    distanceToLine(start, linePoint, rawDirection) > 1e-7 ||
    distanceToLine(end, linePoint, rawDirection) > 1e-7
  ) {
    return invalidTopology(semanticKey, 'Edge line geometry disagrees with its vertices');
  }
  return success({ id: edgeId, startId, endId, start, end, lineDirection });
}

function readVertex(
  reader: IfcReferenceReader,
  vertexId: number,
  scale: number
): ObservationVector | null {
  if (reader.lineType(vertexId) !== WebIFC.IFCVERTEXPOINT) return null;
  const pointId = refValue(reader.getLine(vertexId)?.['VertexGeometry']);
  return pointId === null ? null : readCartesianPoint(reader, pointId, scale);
}

function readCartesianPoint(
  reader: IfcReferenceReader,
  pointId: number,
  scale: number
): ObservationVector | null {
  if (reader.lineType(pointId) !== WebIFC.IFCCARTESIANPOINT) return null;
  const values = numberList(reader.getLine(pointId)?.['Coordinates']);
  if (values === null || values.length !== 3) return null;
  const [x, y, z] = values;
  return x === undefined || y === undefined || z === undefined
    ? null
    : scaleVector([x, y, z], scale);
}

function readDirection(reader: IfcReferenceReader, directionId: number): ObservationVector | null {
  if (reader.lineType(directionId) !== WebIFC.IFCDIRECTION) return null;
  const values = numberList(reader.getLine(directionId)?.['DirectionRatios']);
  if (values === null || values.length !== 3) return null;
  const [x, y, z] = values;
  return x === undefined || y === undefined || z === undefined ? null : normalize([x, y, z]);
}

function references(value: unknown): number[] {
  return (arrayValue(value) ?? []).map(refValue).filter((item): item is number => item !== null);
}

function dimensions(points: readonly ObservationVector[]): ObservationVector | null {
  if (points.length === 0) return null;
  const mins: [number, number, number] = [Infinity, Infinity, Infinity];
  const maxs: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const point of points) {
    for (let axis = 0; axis < 3; axis++) {
      mins[axis] = Math.min(mins[axis] ?? Infinity, point[axis] ?? Infinity);
      maxs[axis] = Math.max(maxs[axis] ?? -Infinity, point[axis] ?? -Infinity);
    }
  }
  const result: ObservationVector = [maxs[0] - mins[0], maxs[1] - mins[1], maxs[2] - mins[2]];
  return result.every((value) => Number.isFinite(value) && value > 0) ? result : null;
}

function compareVectors(left: ObservationVector, right: ObservationVector): number {
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

function subtract(left: ObservationVector, right: ObservationVector): ObservationVector {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function negate(vector: ObservationVector): ObservationVector {
  return [-vector[0], -vector[1], -vector[2]];
}

function dot(left: ObservationVector, right: ObservationVector): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function distance(left: ObservationVector, right: ObservationVector): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

function distanceToLine(
  point: ObservationVector,
  linePoint: ObservationVector,
  direction: ObservationVector
): number {
  const offset = subtract(point, linePoint);
  return Math.hypot(...cross(offset, direction));
}

function invalidTopology(semanticKey: string, message: string): DecodeResult<never> {
  return failure('INVALID_TOPOLOGY', message, { semanticKey });
}

function openTopology(semanticKey: string): DecodeResult<never> {
  return failure('OPEN_TOPOLOGY', 'Advanced B-Rep shell is not a closed two-manifold', {
    semanticKey,
  });
}

function unsupported(semanticKey: string, message: string): DecodeResult<never> {
  return failure('UNSUPPORTED_REPRESENTATION', message, { semanticKey });
}
