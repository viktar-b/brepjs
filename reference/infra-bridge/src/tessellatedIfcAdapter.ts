import * as WebIFC from 'web-ifc';
import type { ObservationVector, Triangle } from './contracts.js';
import {
  arrayValue,
  booleanValue,
  failure,
  numberList,
  refValue,
  scaleVector,
  success,
  type DecodeResult,
  type RepresentationDecoder,
} from './ifcReferenceAdapter.js';

/** Internal Adapter for one complete IfcTriangulatedFaceSet item. */
export const tessellatedRepresentationDecoder: RepresentationDecoder = {
  itemType: WebIFC.IFCTRIANGULATEDFACESET,
  decode({ reader, itemId, semanticKey, millimetresPerFileUnit }) {
    const faceSet = reader.getLine(itemId);
    if (faceSet === null) return unsupportedRepresentation(semanticKey, 'triangulated-face-set');

    const pointListId = refValue(faceSet['Coordinates']);
    if (pointListId === null || reader.lineType(pointListId) !== WebIFC.IFCCARTESIANPOINTLIST3D) {
      return unsupportedRepresentation(semanticKey, 'face-set-coordinates');
    }
    const pointList = reader.getLine(pointListId);
    const rawPoints = pointList === null ? null : vectorRows(pointList['CoordList']);
    if (rawPoints === null || rawPoints.length === 0) {
      return failure('INVALID_TOPOLOGY', 'The face set has no valid coordinate list', {
        semanticKey,
      });
    }

    const pointMap = optionalIntegerList(faceSet['PnIndex']);
    if (!pointMap.ok) {
      return failure('INVALID_INDICES', 'PnIndex must contain one-based integer indices', {
        semanticKey,
        field: 'PnIndex',
      });
    }

    const selectedPoints: ObservationVector[] = [];
    if (pointMap.value === undefined) {
      selectedPoints.push(...rawPoints.map((point) => scaleVector(point, millimetresPerFileUnit)));
    } else {
      for (const pointIndex of pointMap.value) {
        if (pointIndex < 1 || pointIndex > rawPoints.length) {
          return invalidIndex(semanticKey, 'PnIndex', pointIndex, rawPoints.length);
        }
        const point = rawPoints[pointIndex - 1];
        if (point === undefined) {
          return invalidIndex(semanticKey, 'PnIndex', pointIndex, rawPoints.length);
        }
        selectedPoints.push(scaleVector(point, millimetresPerFileUnit));
      }
    }

    const rawTriangles = integerRows(faceSet['CoordIndex']);
    if (rawTriangles === null) {
      return failure('INVALID_INDICES', 'CoordIndex must contain triangular integer rows', {
        semanticKey,
        field: 'CoordIndex',
      });
    }

    const triangles: Triangle[] = [];
    for (const row of rawTriangles) {
      if (row.length !== 3) {
        return failure('INVALID_INDICES', 'Each CoordIndex row must contain three indices', {
          semanticKey,
          field: 'CoordIndex',
        });
      }
      for (const pointIndex of row) {
        if (pointIndex < 1 || pointIndex > selectedPoints.length) {
          return invalidIndex(semanticKey, 'CoordIndex', pointIndex, selectedPoints.length);
        }
      }
      const [first, second, third] = row;
      if (first === undefined || second === undefined || third === undefined) {
        return failure('INVALID_INDICES', 'Each CoordIndex row must contain three indices', {
          semanticKey,
          field: 'CoordIndex',
        });
      }
      const triangle: Triangle = [first - 1, second - 1, third - 1];
      if (new Set(triangle).size !== 3) {
        return failure('INVALID_TOPOLOGY', 'The face set contains a degenerate triangle', {
          semanticKey,
        });
      }
      triangles.push(triangle);
    }

    if (booleanValue(faceSet['Closed']) !== true) {
      return failure('OPEN_TOPOLOGY', 'The selected triangulated face set is not closed', {
        semanticKey,
      });
    }
    if (!hasClosedTriangleTopology(triangles)) {
      return failure(
        'INVALID_TOPOLOGY',
        'The closed face set is not a two-manifold triangle shell',
        { semanticKey }
      );
    }

    return success({
      comparisonSurface: {
        unit: 'millimetre',
        vertices: selectedPoints,
        triangles,
        closed: true,
      },
    });
  },
};

function hasClosedTriangleTopology(triangles: readonly Triangle[]): boolean {
  if (triangles.length < 4) return false;
  const edgeUses = new Map<string, number>();
  for (const [a, b, c] of triangles) {
    for (const [start, end] of [
      [a, b],
      [b, c],
      [c, a],
    ] as const) {
      const key = start < end ? `${start}:${end}` : `${end}:${start}`;
      edgeUses.set(key, (edgeUses.get(key) ?? 0) + 1);
    }
  }
  return edgeUses.size > 0 && [...edgeUses.values()].every((uses) => uses === 2);
}

function vectorRows(value: unknown): ObservationVector[] | null {
  const rows = arrayValue(value);
  if (rows === null) return null;
  const result: ObservationVector[] = [];
  for (const row of rows) {
    const values = numberList(row);
    if (values === null || values.length !== 3 || values.some((item) => !Number.isFinite(item))) {
      return null;
    }
    const [x, y, z] = values;
    if (x === undefined || y === undefined || z === undefined) return null;
    result.push([x, y, z]);
  }
  return result;
}

function integerRows(value: unknown): number[][] | null {
  const rows = arrayValue(value);
  if (rows === null) return null;
  const result: number[][] = [];
  for (const row of rows) {
    const values = numberList(row);
    if (values === null || values.some((item) => !Number.isInteger(item))) return null;
    result.push(values);
  }
  return result;
}

function optionalIntegerList(value: unknown): DecodeResult<readonly number[] | undefined> {
  if (value === null || value === undefined) return success(undefined);
  const values = numberList(value);
  if (values === null || values.some((item) => !Number.isInteger(item))) {
    return failure('INVALID_INDICES', 'The optional point map is malformed');
  }
  return success(values);
}

function invalidIndex(
  semanticKey: string,
  field: 'CoordIndex' | 'PnIndex',
  index: number,
  upperBound: number
): DecodeResult<never> {
  return failure('INVALID_INDICES', `${field} contains an out-of-range one-based index`, {
    semanticKey,
    field,
    index,
    upperBound,
  });
}

function unsupportedRepresentation(semanticKey: string, stage: string): DecodeResult<never> {
  return failure(
    'UNSUPPORTED_REPRESENTATION',
    'The selected face set does not contain a valid coordinate list',
    { semanticKey, stage }
  );
}
