import * as WebIFC from 'web-ifc';
import type { AnalyticEvidence, ObservationVector, Triangle } from './contracts.js';
import {
  cross,
  failure,
  multiply,
  normalize,
  numberList,
  numericValue,
  readAxisPlacement3D,
  refValue,
  success,
  type IfcReferenceReader,
  type Matrix,
  type RepresentationDecoder,
} from './ifcReferenceAdapter.js';

/** Internal deterministic Adapter for one complete IfcExtrudedAreaSolid item. */
export const parametricRepresentationDecoder: RepresentationDecoder = {
  itemType: WebIFC.IFCEXTRUDEDAREASOLID,
  decode({ reader, itemId, semanticKey, millimetresPerFileUnit }) {
    const solid = reader.getLine(itemId);
    if (solid === null) return unsupportedParametricRepresentation(semanticKey);

    const profileId = refValue(solid['SweptArea']);
    if (profileId === null || reader.lineType(profileId) !== WebIFC.IFCRECTANGLEPROFILEDEF) {
      return failure(
        'UNSUPPORTED_REPRESENTATION',
        'The parametric Representation Decoder supports rectangle profiles only',
        { semanticKey }
      );
    }
    const profile = reader.getLine(profileId);
    if (profile === null) return unsupportedParametricRepresentation(semanticKey);

    const xDimension = numericValue(profile['XDim']);
    const yDimension = numericValue(profile['YDim']);
    const depth = numericValue(solid['Depth']);
    if (
      xDimension === null ||
      yDimension === null ||
      depth === null ||
      xDimension <= 0 ||
      yDimension <= 0 ||
      depth <= 0
    ) {
      return failure(
        'INVALID_TOPOLOGY',
        'Rectangle dimensions and extrusion depth must be positive',
        { semanticKey }
      );
    }

    const profilePlacement = readOptionalAxisPlacement2D(
      reader,
      refValue(profile['Position']),
      millimetresPerFileUnit
    );
    const solidPlacement = readOptionalAxisPlacement3D(
      reader,
      refValue(solid['Position']),
      millimetresPerFileUnit
    );
    if (profilePlacement === null || solidPlacement === null) {
      return failure(
        'PLACEMENT_FAILURE',
        'The parametric profile or solid placement could not be resolved',
        { semanticKey }
      );
    }

    const directionId = refValue(solid['ExtrudedDirection']);
    const extrusionDirection = directionId === null ? null : readDirection3D(reader, directionId);
    if (extrusionDirection === null || Math.abs(extrusionDirection[2]) < 1e-12) {
      return failure(
        'INVALID_TOPOLOGY',
        'Extrusion direction must be non-zero and cross the profile plane',
        { semanticKey }
      );
    }

    const profileToComponent = multiply(solidPlacement, profilePlacement);
    const xDimensionMm = xDimension * millimetresPerFileUnit;
    const yDimensionMm = yDimension * millimetresPerFileUnit;
    const depthMm = depth * millimetresPerFileUnit;
    const halfX = xDimensionMm / 2;
    const halfY = yDimensionMm / 2;
    const base = [
      transformPoint(profileToComponent, [-halfX, -halfY, 0]),
      transformPoint(profileToComponent, [halfX, -halfY, 0]),
      transformPoint(profileToComponent, [halfX, halfY, 0]),
      transformPoint(profileToComponent, [-halfX, halfY, 0]),
    ] as const;
    const componentExtrusionDirection = transformDirection(solidPlacement, extrusionDirection);
    const extrusion = scale(componentExtrusionDirection, depthMm);
    const end = base.map((point) => add(point, extrusion));
    const vertices = [...base, ...end];
    const positiveProfileNormal = extrusionDirection[2] > 0;
    const triangles = extrusionTriangles(positiveProfileNormal);

    const profileX = transformDirection(profileToComponent, [1, 0, 0]);
    const profileY = transformDirection(profileToComponent, [0, 1, 0]);
    const profileNormal = canonicalVector(cross(profileX, profileY));
    const edgeDirections = [profileX, profileY, negate(profileX), negate(profileY)] as const;
    const baseNormal = positiveProfileNormal ? negate(profileNormal) : profileNormal;
    const endNormal = negate(baseNormal);
    const sideNormals = edgeDirections.map((edge) => {
      const normal = positiveProfileNormal
        ? cross(edge, componentExtrusionDirection)
        : cross(componentExtrusionDirection, edge);
      return canonicalVector(normalize(normal) ?? normal);
    });

    return success({
      comparisonSurface: {
        unit: 'millimetre',
        vertices,
        triangles,
        closed: true,
      },
      dimensions: [
        { name: 'profile-x-dimension', value: xDimensionMm, unit: 'millimetre' },
        { name: 'profile-y-dimension', value: yDimensionMm, unit: 'millimetre' },
        { name: 'extrusion-depth', value: depthMm, unit: 'millimetre' },
      ],
      analyticEvidence: analyticEvidence(
        baseNormal,
        endNormal,
        sideNormals,
        edgeDirections,
        componentExtrusionDirection
      ),
    });
  },
};

function analyticEvidence(
  baseNormal: ObservationVector,
  endNormal: ObservationVector,
  sideNormals: readonly ObservationVector[],
  edgeDirections: readonly ObservationVector[],
  extrusionDirection: ObservationVector
): AnalyticEvidence {
  return {
    surfaces: [baseNormal, endNormal, ...sideNormals].map((normal) => ({
      kind: 'plane',
      normal,
    })),
    curves: [
      ...edgeDirections,
      ...edgeDirections,
      extrusionDirection,
      extrusionDirection,
      extrusionDirection,
      extrusionDirection,
    ].map((direction) => ({ kind: 'line', direction })),
    topology: {
      vertexCount: 8,
      edgeCount: 12,
      faceCount: 6,
      closed: true,
    },
  };
}

function extrusionTriangles(positiveProfileNormal: boolean): readonly Triangle[] {
  if (positiveProfileNormal) {
    return [
      [0, 2, 1],
      [0, 3, 2],
      [4, 5, 6],
      [4, 6, 7],
      [0, 1, 5],
      [0, 5, 4],
      [1, 2, 6],
      [1, 6, 5],
      [2, 3, 7],
      [2, 7, 6],
      [3, 0, 4],
      [3, 4, 7],
    ];
  }
  return [
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
  ];
}

function readOptionalAxisPlacement3D(
  reader: IfcReferenceReader,
  placementId: number | null,
  millimetresPerFileUnit: number
): Matrix | null {
  return placementId === null
    ? identityMatrix()
    : readAxisPlacement3D(reader, placementId, millimetresPerFileUnit);
}

function readOptionalAxisPlacement2D(
  reader: IfcReferenceReader,
  placementId: number | null,
  millimetresPerFileUnit: number
): Matrix | null {
  if (placementId === null) return identityMatrix();
  if (reader.lineType(placementId) !== WebIFC.IFCAXIS2PLACEMENT2D) return null;
  const placement = reader.getLine(placementId);
  if (placement === null) return null;
  const locationId = refValue(placement['Location']);
  const location = locationId === null ? null : readPoint2D(reader, locationId);
  if (location === null) return null;
  const directionId = refValue(placement['RefDirection']);
  const rawX = directionId === null ? ([1, 0] as const) : readDirection2D(reader, directionId);
  if (rawX === null) return null;
  const length = Math.hypot(rawX[0], rawX[1]);
  if (!Number.isFinite(length) || length < 1e-12) return null;
  const x = [rawX[0] / length, rawX[1] / length] as const;
  const y = [-x[1], x[0]] as const;
  return [
    x[0],
    x[1],
    0,
    0,
    y[0],
    y[1],
    0,
    0,
    0,
    0,
    1,
    0,
    location[0] * millimetresPerFileUnit,
    location[1] * millimetresPerFileUnit,
    0,
    1,
  ];
}

function readPoint2D(
  reader: IfcReferenceReader,
  pointId: number
): readonly [number, number] | null {
  const values = numberList(reader.getLine(pointId)?.['Coordinates']);
  if (values === null || values.length !== 2) return null;
  const [x, y] = values;
  return x === undefined || y === undefined ? null : [x, y];
}

function readDirection2D(
  reader: IfcReferenceReader,
  directionId: number
): readonly [number, number] | null {
  const values = numberList(reader.getLine(directionId)?.['DirectionRatios']);
  if (values === null || values.length !== 2) return null;
  const [x, y] = values;
  return x === undefined || y === undefined ? null : [x, y];
}

function readDirection3D(
  reader: IfcReferenceReader,
  directionId: number
): ObservationVector | null {
  const values = numberList(reader.getLine(directionId)?.['DirectionRatios']);
  if (values === null || values.length !== 3) return null;
  const [x, y, z] = values;
  return x === undefined || y === undefined || z === undefined ? null : normalize([x, y, z]);
}

function transformPoint(matrix: Matrix, point: ObservationVector): ObservationVector {
  return canonicalVector([
    matrix[0] * point[0] + matrix[4] * point[1] + matrix[8] * point[2] + matrix[12],
    matrix[1] * point[0] + matrix[5] * point[1] + matrix[9] * point[2] + matrix[13],
    matrix[2] * point[0] + matrix[6] * point[1] + matrix[10] * point[2] + matrix[14],
  ]);
}

function transformDirection(matrix: Matrix, direction: ObservationVector): ObservationVector {
  return canonicalVector(
    normalize([
      matrix[0] * direction[0] + matrix[4] * direction[1] + matrix[8] * direction[2],
      matrix[1] * direction[0] + matrix[5] * direction[1] + matrix[9] * direction[2],
      matrix[2] * direction[0] + matrix[6] * direction[1] + matrix[10] * direction[2],
    ]) ?? direction
  );
}

function add(a: ObservationVector, b: ObservationVector): ObservationVector {
  return canonicalVector([a[0] + b[0], a[1] + b[1], a[2] + b[2]]);
}

function scale(vector: ObservationVector, factor: number): ObservationVector {
  return canonicalVector([vector[0] * factor, vector[1] * factor, vector[2] * factor]);
}

function negate(vector: ObservationVector): ObservationVector {
  return canonicalVector([-vector[0], -vector[1], -vector[2]]);
}

function canonicalVector(vector: ObservationVector): ObservationVector {
  return vector.map(canonicalNumber) as unknown as ObservationVector;
}

function canonicalNumber(value: number): number {
  if (Math.abs(value) < 1e-12) return 0;
  return Math.round(value * 1e12) / 1e12;
}

function identityMatrix(): Matrix {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function unsupportedParametricRepresentation(semanticKey: string) {
  return failure(
    'UNSUPPORTED_REPRESENTATION',
    'The selected parametric representation could not be read',
    { semanticKey }
  );
}
