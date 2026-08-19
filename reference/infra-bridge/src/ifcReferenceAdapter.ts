import * as WebIFC from 'web-ifc';
import type {
  AnalyticEvidence,
  DimensionObservation,
  ObservationVector,
  ObservedFrame,
  ReconstructionTarget,
  ReferenceProductNode,
  ReferenceScene,
  SurfaceObservation,
} from './contracts.js';
import { referenceHarnessError, type ReferenceHarnessError } from './errors.js';

interface ManifestSelection {
  readonly semanticKey: string;
  readonly referenceGlobalId: string;
}

type RawLine = Readonly<Record<string, unknown>>;
export type Matrix = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export type DecodeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ReferenceHarnessError };

export interface RepresentationObservation {
  readonly comparisonSurface: SurfaceObservation;
  readonly dimensions?: readonly DimensionObservation[] | undefined;
  readonly analyticEvidence?: AnalyticEvidence | undefined;
}

export interface RepresentationDecodeContext {
  readonly reader: IfcReferenceReader;
  readonly itemId: number;
  readonly semanticKey: string;
  readonly millimetresPerFileUnit: number;
}

/** Internal seam implemented once per complete IFC representation item lane. */
export interface RepresentationDecoder {
  readonly itemType: number;
  decode(context: RepresentationDecodeContext): DecodeResult<RepresentationObservation>;
}

interface DecodedSelection {
  readonly target: ReconstructionTarget;
  readonly product: ReferenceProductNode;
}

interface DecodedReference {
  readonly targets: readonly ReconstructionTarget[];
  readonly scene: ReferenceScene;
}

/** Shared IFC model reader used only inside the Reference Harness implementation. */
export class IfcReferenceReader {
  readonly modelId: number;
  readonly #api: WebIFC.IfcAPI;
  #closed = false;

  private constructor(api: WebIFC.IfcAPI, modelId: number) {
    this.#api = api;
    this.modelId = modelId;
  }

  static async open(bytes: Uint8Array): Promise<DecodeResult<IfcReferenceReader>> {
    const api = new WebIFC.IfcAPI();
    let modelId: number | undefined;
    try {
      await api.Init(undefined, true);
      modelId = api.OpenModel(bytes, { COORDINATE_TO_ORIGIN: false });
      if (modelId < 0 || !api.IsModelOpen(modelId)) {
        return failure(
          'UNSUPPORTED_REPRESENTATION',
          'The supplied bytes are not a readable IFC reference',
          { stage: 'open-model' }
        );
      }
      const schema = api.GetModelSchema(modelId);
      if (!schema.startsWith('IFC4X3')) {
        api.CloseModel(modelId);
        return failure('UNSUPPORTED_REPRESENTATION', 'The IFC Reference Adapter requires IFC4X3', {
          schema,
        });
      }
      return success(new IfcReferenceReader(api, modelId));
    } catch (cause) {
      if (modelId !== undefined && modelId >= 0 && api.IsModelOpen(modelId)) {
        api.CloseModel(modelId);
      }
      return failure(
        'UNSUPPORTED_REPRESENTATION',
        'The IFC Reference Adapter could not open the reference',
        { cause: errorMessage(cause) }
      );
    }
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#api.IsModelOpen(this.modelId)) this.#api.CloseModel(this.modelId);
  }

  getLine(expressId: number): RawLine | null {
    const line = this.#api.GetLine(this.modelId, expressId, false) as unknown;
    return line !== null && typeof line === 'object' && !Array.isArray(line)
      ? (line as RawLine)
      : null;
  }

  lineType(expressId: number): number {
    const type = this.#api.GetLineType(this.modelId, expressId) as unknown;
    const unwrapped = unwrap(type);
    return typeof unwrapped === 'number' ? unwrapped : Number.NaN;
  }

  lineIds(type: number): number[] {
    const vector = this.#api.GetLineIDsWithType(this.modelId, type);
    const result: number[] = [];
    for (let index = 0; index < vector.size(); index++) result.push(vector.get(index));
    (vector as unknown as { delete?: () => void }).delete?.();
    return result;
  }

  buildGuidMap(): void {
    this.#api.CreateIfcGuidToExpressIdMapping(this.modelId);
  }

  expressIdFromGuid(guid: string): number | undefined {
    const expressId = this.#api.GetExpressIdFromGuid(this.modelId, guid);
    return typeof expressId === 'number' && Number.isInteger(expressId) && expressId > 0
      ? expressId
      : undefined;
  }

  decodedString(value: unknown): string | undefined {
    const unwrapped = unwrap(value);
    if (typeof unwrapped !== 'string' || unwrapped.length === 0) return undefined;
    const decoded = this.#api.DecodeText(unwrapped) as unknown;
    return typeof decoded === 'string' ? decoded : unwrapped;
  }
}

/** Decode selected products and dispatch their complete representation items internally. */
export async function decodeIfcReference(
  bytes: Uint8Array,
  selections: readonly ManifestSelection[],
  decoders: readonly RepresentationDecoder[]
): Promise<DecodeResult<DecodedReference>> {
  const opened = await IfcReferenceReader.open(bytes);
  if (!opened.ok) return opened;
  const reader = opened.value;

  try {
    const lengthScale = readLengthScaleToMillimetres(reader);
    if (!lengthScale.ok) return lengthScale;
    reader.buildGuidMap();

    const decoded: DecodedSelection[] = [];
    for (const selection of selections) {
      const product = decodeSelection(reader, selection, lengthScale.value, decoders);
      if (!product.ok) return product;
      decoded.push(product.value);
    }

    return success({
      targets: decoded.map(({ target }) => target),
      scene: {
        unit: 'millimetre',
        roots: decoded.map(({ product }) => product),
      },
    });
  } catch (cause) {
    return failure(
      'UNSUPPORTED_REPRESENTATION',
      'The IFC Reference Adapter could not decode the selected products',
      { cause: errorMessage(cause) }
    );
  } finally {
    reader.close();
  }
}

function decodeSelection(
  reader: IfcReferenceReader,
  selection: ManifestSelection,
  millimetresPerFileUnit: number,
  decoders: readonly RepresentationDecoder[]
): DecodeResult<DecodedSelection> {
  const productId = reader.expressIdFromGuid(selection.referenceGlobalId);
  if (productId === undefined) {
    return failure(
      'UNSUPPORTED_REPRESENTATION',
      'A manifest selection does not identify an IFC product',
      { semanticKey: selection.semanticKey }
    );
  }
  const product = reader.getLine(productId);
  if (product === null) {
    return failure('UNSUPPORTED_REPRESENTATION', 'The selected IFC product could not be read', {
      semanticKey: selection.semanticKey,
    });
  }

  const items = readBodyRepresentationItems(reader, product);
  if (items.length !== 1) {
    return failure(
      'UNSUPPORTED_REPRESENTATION',
      'The selected product must contain exactly one complete representation item',
      { semanticKey: selection.semanticKey, itemCount: items.length }
    );
  }
  const itemId = items[0];
  if (itemId === undefined) {
    return failure('UNSUPPORTED_REPRESENTATION', 'The selected product Body is empty', {
      semanticKey: selection.semanticKey,
    });
  }
  const itemType = reader.lineType(itemId);
  const decoder = decoders.find((candidate) => candidate.itemType === itemType);
  if (decoder === undefined) {
    return failure(
      'UNSUPPORTED_REPRESENTATION',
      'No Representation Decoder supports the selected complete item',
      { semanticKey: selection.semanticKey }
    );
  }
  const representation = decoder.decode({
    reader,
    itemId,
    semanticKey: selection.semanticKey,
    millimetresPerFileUnit,
  });
  if (!representation.ok) return representation;

  const placementId = refValue(product['ObjectPlacement']);
  if (placementId === null) return placementFailure(selection.semanticKey);
  const worldFrame = readProductWorldFrame(
    reader,
    placementId,
    selection.semanticKey,
    millimetresPerFileUnit
  );
  if (!worldFrame.ok) return worldFrame;

  const name = reader.decodedString(product['Name']);
  const material = readMaterialName(reader, productId);
  return success({
    target: {
      semanticKey: selection.semanticKey,
      comparisonSurface: representation.value.comparisonSurface,
      ...(representation.value.dimensions === undefined
        ? {}
        : { dimensions: representation.value.dimensions }),
      ...(representation.value.analyticEvidence === undefined
        ? {}
        : { analyticEvidence: representation.value.analyticEvidence }),
    },
    product: {
      kind: 'product',
      referenceKey: selection.semanticKey,
      ...(name === undefined ? {} : { name }),
      // No IFC parent is returned in this gate, so the root's local frame is world-relative.
      localFrame: worldFrame.value,
      worldFrame: worldFrame.value,
      ...(material === undefined ? {} : { material }),
      targetKey: selection.semanticKey,
    },
  });
}

function readBodyRepresentationItems(reader: IfcReferenceReader, product: RawLine): number[] {
  const productShapeId = refValue(product['Representation']);
  if (productShapeId === null) return [];
  const productShape = reader.getLine(productShapeId);
  if (productShape === null) return [];
  const items: number[] = [];
  for (const representationId of refArray(productShape['Representations'])) {
    const representation = reader.getLine(representationId);
    if (representation === null) continue;
    const identifier = reader.decodedString(representation['RepresentationIdentifier']);
    if (identifier?.toLowerCase() !== 'body') continue;
    items.push(...refArray(representation['Items']));
  }
  return items;
}

function readLengthScaleToMillimetres(reader: IfcReferenceReader): DecodeResult<number> {
  for (const projectId of reader.lineIds(WebIFC.IFCPROJECT)) {
    const project = reader.getLine(projectId);
    const assignmentId = refValue(project?.['UnitsInContext']);
    if (assignmentId === null || reader.lineType(assignmentId) !== WebIFC.IFCUNITASSIGNMENT) {
      continue;
    }
    const assignment = reader.getLine(assignmentId);
    for (const unitId of refArray(assignment?.['Units'])) {
      if (reader.lineType(unitId) !== WebIFC.IFCSIUNIT) continue;
      const unit = reader.getLine(unitId);
      if (unit === null || enumValue(unit['UnitType']) !== 'LENGTHUNIT') continue;
      if (enumValue(unit['Name']) !== 'METRE') continue;
      const factor = siPrefixFactor(enumValue(unit['Prefix']));
      if (factor !== null) return success(factor * 1000);
    }
  }
  return failure('UNIT_FAILURE', 'The IFC project has no supported physical length unit', {
    expectedUnit: 'SI length unit',
  });
}

function readProductWorldFrame(
  reader: IfcReferenceReader,
  placementId: number,
  semanticKey: string,
  millimetresPerFileUnit: number
): DecodeResult<ObservedFrame> {
  const worldMatrix = composeLocalPlacement(reader, placementId, millimetresPerFileUnit, new Set());
  return worldMatrix === null
    ? placementFailure(semanticKey)
    : success(frameFromMatrix(worldMatrix));
}

function composeLocalPlacement(
  reader: IfcReferenceReader,
  placementId: number,
  millimetresPerFileUnit: number,
  seen: Set<number>
): Matrix | null {
  if (seen.has(placementId)) return null;
  seen.add(placementId);
  const placement = reader.getLine(placementId);
  if (placement === null || reader.lineType(placementId) !== WebIFC.IFCLOCALPLACEMENT) return null;
  const relativeId = refValue(placement['RelativePlacement']);
  if (relativeId === null) return null;
  const relative = readAxisPlacement3D(reader, relativeId, millimetresPerFileUnit);
  if (relative === null) return null;
  const parentId = refValue(placement['PlacementRelTo']);
  if (parentId === null) return relative;
  const parent = composeLocalPlacement(reader, parentId, millimetresPerFileUnit, seen);
  return parent === null ? null : multiply(parent, relative);
}

/** Read an IfcAxis2Placement3D as a physical-mm local-to-parent matrix. */
export function readAxisPlacement3D(
  reader: IfcReferenceReader,
  placementId: number,
  millimetresPerFileUnit: number
): Matrix | null {
  if (reader.lineType(placementId) !== WebIFC.IFCAXIS2PLACEMENT3D) return null;
  const placement = reader.getLine(placementId);
  if (placement === null) return null;
  const locationId = refValue(placement['Location']);
  if (locationId === null) return null;
  const location = readPoint(reader, locationId);
  if (location === null) return null;
  const z = readOptionalDirection(reader, refValue(placement['Axis']), [0, 0, 1]);
  const rawX = readOptionalDirection(reader, refValue(placement['RefDirection']), [1, 0, 0]);
  if (z === null || rawX === null) return null;
  const unitZ = normalize(z);
  if (unitZ === null) return null;
  const projection = dot(unitZ, rawX);
  const projectedX: ObservationVector = [
    rawX[0] - projection * unitZ[0],
    rawX[1] - projection * unitZ[1],
    rawX[2] - projection * unitZ[2],
  ];
  const unitX = normalize(projectedX);
  if (unitX === null) return null;
  const unitY = cross(unitZ, unitX);
  const origin = scaleVector(location, millimetresPerFileUnit);
  return [
    unitX[0],
    unitX[1],
    unitX[2],
    0,
    unitY[0],
    unitY[1],
    unitY[2],
    0,
    unitZ[0],
    unitZ[1],
    unitZ[2],
    0,
    origin[0],
    origin[1],
    origin[2],
    1,
  ];
}

function readPoint(reader: IfcReferenceReader, pointId: number): ObservationVector | null {
  const point = reader.getLine(pointId);
  const values = numberList(point?.['Coordinates']);
  if (values === null || values.length < 2) return null;
  return vectorFromAtLeastTwo(values);
}

function readOptionalDirection(
  reader: IfcReferenceReader,
  directionId: number | null,
  fallback: ObservationVector
): ObservationVector | null {
  if (directionId === null) return fallback;
  const direction = reader.getLine(directionId);
  const values = numberList(direction?.['DirectionRatios']);
  if (values === null || values.length < 2) return null;
  return vectorFromAtLeastTwo(values);
}

function readMaterialName(reader: IfcReferenceReader, productId: number): string | undefined {
  for (const relationId of reader.lineIds(WebIFC.IFCRELASSOCIATESMATERIAL)) {
    const relation = reader.getLine(relationId);
    if (!refArray(relation?.['RelatedObjects']).includes(productId)) continue;
    const materialId = refValue(relation?.['RelatingMaterial']);
    if (materialId === null || reader.lineType(materialId) !== WebIFC.IFCMATERIAL) continue;
    return reader.decodedString(reader.getLine(materialId)?.['Name']);
  }
  return undefined;
}

function frameFromMatrix(matrix: Matrix): ObservedFrame {
  return {
    origin: [matrix[12], matrix[13], matrix[14]],
    xAxis: [matrix[0], matrix[1], matrix[2]],
    zAxis: [matrix[8], matrix[9], matrix[10]],
  };
}

export function multiply(a: Matrix, b: Matrix): Matrix {
  const result: [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      for (let index = 0; index < 4; index++) {
        const resultIndex = column * 4 + row;
        result[resultIndex] =
          (result[resultIndex] ?? 0) + (a[index * 4 + row] ?? 0) * (b[column * 4 + index] ?? 0);
      }
    }
  }
  return result;
}

function vectorFromAtLeastTwo(values: readonly number[]): ObservationVector | null {
  const x = values[0];
  const y = values[1];
  if (x === undefined || y === undefined) return null;
  return [x, y, values[2] ?? 0];
}

export function scaleVector(
  vector: ObservationVector,
  millimetresPerFileUnit: number
): ObservationVector {
  return [
    vector[0] * millimetresPerFileUnit,
    vector[1] * millimetresPerFileUnit,
    vector[2] * millimetresPerFileUnit,
  ];
}

export function normalize(vector: ObservationVector): ObservationVector | null {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (!Number.isFinite(length) || length < 1e-12) return null;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function dot(a: ObservationVector, b: ObservationVector): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: ObservationVector, b: ObservationVector): ObservationVector {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function numberList(value: unknown): number[] | null {
  const values = arrayValue(value);
  if (values === null) return null;
  const result: number[] = [];
  for (const item of values) {
    const number = numericValue(item);
    if (number === null) return null;
    result.push(number);
  }
  return result;
}

export function arrayValue(value: unknown): readonly unknown[] | null {
  const unwrapped = unwrap(value);
  return Array.isArray(unwrapped) ? unwrapped : null;
}

export function numericValue(value: unknown): number | null {
  const unwrapped = unwrap(value);
  return typeof unwrapped === 'number' && Number.isFinite(unwrapped) ? unwrapped : null;
}

export function booleanValue(value: unknown): boolean | null {
  const unwrapped = unwrap(value);
  return typeof unwrapped === 'boolean' ? unwrapped : null;
}

function enumValue(value: unknown): string | null {
  const unwrapped = unwrap(value);
  return typeof unwrapped === 'string' ? unwrapped.replaceAll('.', '').toUpperCase() : null;
}

export function refValue(value: unknown): number | null {
  const unwrapped = unwrap(value);
  return typeof unwrapped === 'number' && Number.isInteger(unwrapped) && unwrapped > 0
    ? unwrapped
    : null;
}

function refArray(value: unknown): number[] {
  return (arrayValue(value) ?? []).map(refValue).filter((item): item is number => item !== null);
}

function unwrap(value: unknown): unknown {
  let current = value;
  for (let depth = 0; depth < 4; depth++) {
    if (
      current === null ||
      typeof current !== 'object' ||
      Array.isArray(current) ||
      !('value' in current)
    ) {
      return current;
    }
    current = (current as { readonly value: unknown }).value;
  }
  return current;
}

function siPrefixFactor(prefix: string | null): number | null {
  switch (prefix) {
    case null:
      return 1;
    case 'KILO':
      return 1000;
    case 'HECTO':
      return 100;
    case 'DECA':
      return 10;
    case 'DECI':
      return 0.1;
    case 'CENTI':
      return 0.01;
    case 'MILLI':
      return 0.001;
    case 'MICRO':
      return 1e-6;
    default:
      return null;
  }
}

export function success<T>(value: T): DecodeResult<T> {
  return { ok: true, value };
}

export function failure(
  code: ReferenceHarnessError['code'],
  message: string,
  context: ReferenceHarnessError['context'] = {}
): DecodeResult<never> {
  return { ok: false, error: referenceHarnessError(code, message, context) };
}

function placementFailure(semanticKey: string): DecodeResult<never> {
  return failure('PLACEMENT_FAILURE', 'The selected product placement could not be composed', {
    semanticKey,
  });
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
