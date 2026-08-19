import * as WebIFC from 'web-ifc';
import type {
  AnalyticEvidence,
  DimensionObservation,
  ObservationVector,
  ObservedFrame,
  ReconstructionTarget,
  ReferenceRepetitionObservation,
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
  readonly representationKey: string;
}

interface ResolvedRepresentationItem {
  readonly itemId: number;
  readonly representationKey: number;
  readonly transform: Matrix;
}

interface DecodedReference {
  readonly targets: readonly ReconstructionTarget[];
  readonly scene: ReferenceScene;
  readonly repetitions?: readonly ReferenceRepetitionObservation[] | undefined;
}

export interface InspectedReferenceProduct {
  readonly referenceGlobalId: string;
  readonly entityType: string;
  readonly name?: string | undefined;
  readonly material?: string | undefined;
  readonly parentReferenceGlobalId?: string | undefined;
  readonly representationItemTypes: readonly string[];
  readonly worldFrame?: ObservedFrame | undefined;
}

export interface InspectedIfcReference {
  readonly schema: string;
  readonly checksumPending: true;
  readonly millimetresPerFileUnit: number;
  readonly entityCounts: Readonly<Record<string, number>>;
  readonly products: readonly InspectedReferenceProduct[];
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

  allLineIds(): number[] {
    const vector = this.#api.GetAllLines(this.modelId);
    const result: number[] = [];
    for (let index = 0; index < vector.size(); index++) result.push(vector.get(index));
    (vector as unknown as { delete?: () => void }).delete?.();
    return result;
  }

  schema(): string {
    return this.#api.GetModelSchema(this.modelId);
  }

  typeName(type: number): string {
    const name = this.#api.GetNameFromTypeCode(type) as unknown;
    return typeof name === 'string' && name.length > 0 ? name : `TYPE_${type}`;
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

/** Harness-owned source inspection used to prepare a checksummed Reference Manifest. */
export async function inspectIfcReference(
  bytes: Uint8Array
): Promise<DecodeResult<InspectedIfcReference>> {
  const opened = await IfcReferenceReader.open(bytes);
  if (!opened.ok) return opened;
  const reader = opened.value;
  try {
    const lengthScale = readLengthScaleToMillimetres(reader);
    if (!lengthScale.ok) return lengthScale;
    const lineIds = reader.allLineIds();
    const counts = new Map<string, number>();
    const guidById = new Map<number, string>();
    const productIds: number[] = [];
    for (const lineId of lineIds) {
      const type = reader.lineType(lineId);
      const typeName = reader.typeName(type);
      counts.set(typeName, (counts.get(typeName) ?? 0) + 1);
      const line = reader.getLine(lineId);
      const guid = reader.decodedString(line?.['GlobalId']);
      if (guid !== undefined) guidById.set(lineId, guid);
      if (guid !== undefined && line !== null && 'ObjectPlacement' in line) productIds.push(lineId);
    }
    const parentById = readProductParents(reader);
    const products = productIds.map((productId): InspectedReferenceProduct => {
      const product = reader.getLine(productId);
      const guid = guidById.get(productId);
      if (product === null || guid === undefined) {
        throw new Error('inspected product disappeared while the model was open');
      }
      const placementId = refValue(product['ObjectPlacement']);
      const worldFrame =
        placementId === null
          ? undefined
          : readProductWorldFrame(reader, placementId, guid, lengthScale.value);
      const parentGuid = guidById.get(parentById.get(productId) ?? -1);
      return {
        referenceGlobalId: guid,
        entityType: reader.typeName(reader.lineType(productId)),
        ...(reader.decodedString(product['Name']) === undefined
          ? {}
          : { name: reader.decodedString(product['Name']) }),
        ...(readMaterialName(reader, productId) === undefined
          ? {}
          : { material: readMaterialName(reader, productId) }),
        ...(parentGuid === undefined ? {} : { parentReferenceGlobalId: parentGuid }),
        representationItemTypes: readRepresentationItemTypes(reader, product),
        ...(worldFrame?.ok === true ? { worldFrame: worldFrame.value } : {}),
      };
    });
    return success({
      schema: reader.schema(),
      checksumPending: true,
      millimetresPerFileUnit: lengthScale.value,
      entityCounts: Object.fromEntries(
        [...counts.entries()].sort(([left], [right]) => left.localeCompare(right))
      ),
      products,
    });
  } catch (cause) {
    return failure('UNSUPPORTED_REPRESENTATION', 'Reference inspection failed', {
      cause: errorMessage(cause),
    });
  } finally {
    reader.close();
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

    const repetitions = repetitionObservations(decoded);
    return success({
      targets: decoded.map(({ target }) => target),
      scene: {
        unit: 'millimetre',
        roots: decoded.map(({ product }) => product),
      },
      ...(repetitions.length === 0 ? {} : { repetitions }),
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
  if (items.length === 0) {
    return failure('UNSUPPORTED_REPRESENTATION', 'The selected product Body is empty', {
      semanticKey: selection.semanticKey,
    });
  }
  const observations: RepresentationObservation[] = [];
  const representationKeys: number[] = [];
  for (const bodyItemId of items) {
    const resolvedItem = resolveRepresentationItem(
      reader,
      bodyItemId,
      millimetresPerFileUnit,
      new Set()
    );
    if (!resolvedItem.ok) return resolvedItem;
    const itemType = reader.lineType(resolvedItem.value.itemId);
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
      itemId: resolvedItem.value.itemId,
      semanticKey: selection.semanticKey,
      millimetresPerFileUnit,
    });
    if (!representation.ok) return representation;
    const transformedRepresentation = transformRepresentationObservation(
      representation.value,
      resolvedItem.value.transform,
      selection.semanticKey
    );
    if (!transformedRepresentation.ok) return transformedRepresentation;
    observations.push(transformedRepresentation.value);
    representationKeys.push(resolvedItem.value.representationKey);
  }
  const combinedRepresentation = combineRepresentationObservations(observations);

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
      comparisonSurface: combinedRepresentation.comparisonSurface,
      ...(combinedRepresentation.dimensions === undefined
        ? {}
        : { dimensions: combinedRepresentation.dimensions }),
      ...(combinedRepresentation.analyticEvidence === undefined
        ? {}
        : { analyticEvidence: combinedRepresentation.analyticEvidence }),
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
    representationKey: representationKeys.join('|'),
  });
}

function repetitionObservations(
  decoded: readonly DecodedSelection[]
): ReferenceRepetitionObservation[] {
  const keysByRepresentation = new Map<string, string[]>();
  for (const selection of decoded) {
    const keys = keysByRepresentation.get(selection.representationKey) ?? [];
    keys.push(selection.target.semanticKey);
    keysByRepresentation.set(selection.representationKey, keys);
  }
  return [...keysByRepresentation.values()]
    .filter((semanticKeys) => semanticKeys.length > 1)
    .map((semanticKeys) => ({ semanticKeys, evidence: 'shared-representation' }));
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

function readRepresentationItemTypes(
  reader: IfcReferenceReader,
  product: RawLine
): readonly string[] {
  const productShapeId = refValue(product['Representation']);
  if (productShapeId === null) return [];
  const productShape = reader.getLine(productShapeId);
  if (productShape === null) return [];
  const names: string[] = [];
  for (const representationId of refArray(productShape['Representations'])) {
    const representation = reader.getLine(representationId);
    if (representation === null) continue;
    const identifier =
      reader.decodedString(representation['RepresentationIdentifier']) ?? 'Unnamed';
    for (const itemId of refArray(representation['Items'])) {
      names.push(`${identifier}:${reader.typeName(reader.lineType(itemId))}`);
    }
  }
  return names;
}

function readProductParents(reader: IfcReferenceReader): ReadonlyMap<number, number> {
  const parentById = new Map<number, number>();
  for (const relationId of reader.lineIds(WebIFC.IFCRELAGGREGATES)) {
    const relation = reader.getLine(relationId);
    const parentId = refValue(relation?.['RelatingObject']);
    if (parentId === null) continue;
    for (const childId of refArray(relation?.['RelatedObjects'])) parentById.set(childId, parentId);
  }
  for (const relationId of reader.lineIds(WebIFC.IFCRELCONTAINEDINSPATIALSTRUCTURE)) {
    const relation = reader.getLine(relationId);
    const parentId = refValue(relation?.['RelatingStructure']);
    if (parentId === null) continue;
    for (const childId of refArray(relation?.['RelatedElements']))
      parentById.set(childId, parentId);
  }
  return parentById;
}

function resolveRepresentationItem(
  reader: IfcReferenceReader,
  itemId: number,
  scale: number,
  seen: Set<number>
): DecodeResult<ResolvedRepresentationItem> {
  if (reader.lineType(itemId) !== WebIFC.IFCMAPPEDITEM) {
    return success({ itemId, representationKey: itemId, transform: identityMatrix() });
  }
  if (seen.has(itemId)) {
    return failure('UNSUPPORTED_REPRESENTATION', 'Mapped representation contains a cycle');
  }
  seen.add(itemId);
  const mappedItem = reader.getLine(itemId);
  const sourceId = refValue(mappedItem?.['MappingSource']);
  const targetId = refValue(mappedItem?.['MappingTarget']);
  if (
    sourceId === null ||
    targetId === null ||
    reader.lineType(sourceId) !== WebIFC.IFCREPRESENTATIONMAP
  ) {
    return failure('UNSUPPORTED_REPRESENTATION', 'Mapped representation is malformed');
  }
  const source = reader.getLine(sourceId);
  const mappingOriginId = refValue(source?.['MappingOrigin']);
  const mappedRepresentationId = refValue(source?.['MappedRepresentation']);
  if (mappingOriginId === null || mappedRepresentationId === null) {
    return failure('UNSUPPORTED_REPRESENTATION', 'Representation map is incomplete');
  }
  const mappedRepresentation = reader.getLine(mappedRepresentationId);
  const mappedItems = refArray(mappedRepresentation?.['Items']);
  if (mappedItems.length !== 1 || mappedItems[0] === undefined) {
    return failure(
      'UNSUPPORTED_REPRESENTATION',
      'A mapped representation must resolve to exactly one complete item'
    );
  }
  const mappingOrigin = readAxisPlacement3D(reader, mappingOriginId, scale);
  const mappingTarget = readCartesianTransformationOperator3D(reader, targetId, scale);
  const inverseOrigin = mappingOrigin === null ? null : invertAffine(mappingOrigin);
  if (mappingOrigin === null || mappingTarget === null || inverseOrigin === null) {
    return failure('PLACEMENT_FAILURE', 'Mapped representation transform could not be composed');
  }
  const nested = resolveRepresentationItem(reader, mappedItems[0], scale, seen);
  if (!nested.ok) return nested;
  return success({
    itemId: nested.value.itemId,
    representationKey: sourceId,
    transform: multiply(multiply(mappingTarget, inverseOrigin), nested.value.transform),
  });
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

function readCartesianTransformationOperator3D(
  reader: IfcReferenceReader,
  operatorId: number,
  millimetresPerFileUnit: number
): Matrix | null {
  const type = reader.lineType(operatorId);
  if (
    type !== WebIFC.IFCCARTESIANTRANSFORMATIONOPERATOR3D &&
    type !== WebIFC.IFCCARTESIANTRANSFORMATIONOPERATOR3DNONUNIFORM
  ) {
    return null;
  }
  const operator = reader.getLine(operatorId);
  if (operator === null) return null;
  const originId = refValue(operator['LocalOrigin']);
  if (originId === null) return null;
  const origin = readPoint(reader, originId);
  if (origin === null) return null;
  const axes = readTransformationAxes(reader, operator);
  if (axes === null) return null;
  const { unitX, unitY, unitZ } = axes;
  if (
    Math.abs(dot(unitX, unitY)) > 1e-7 ||
    Math.abs(dot(unitX, unitZ)) > 1e-7 ||
    Math.abs(dot(unitY, unitZ)) > 1e-7
  ) {
    return null;
  }
  const scale1 = numericValue(operator['Scale']) ?? 1;
  const scale2 = numericValue(operator['Scale2']) ?? scale1;
  const scale3 = numericValue(operator['Scale3']) ?? scale1;
  if (![scale1, scale2, scale3].every((value) => Number.isFinite(value) && value > 0)) return null;
  const translated = scaleVector(origin, millimetresPerFileUnit);
  return [
    unitX[0] * scale1,
    unitX[1] * scale1,
    unitX[2] * scale1,
    0,
    unitY[0] * scale2,
    unitY[1] * scale2,
    unitY[2] * scale2,
    0,
    unitZ[0] * scale3,
    unitZ[1] * scale3,
    unitZ[2] * scale3,
    0,
    translated[0],
    translated[1],
    translated[2],
    1,
  ];
}

function readTransformationAxes(
  reader: IfcReferenceReader,
  operator: RawLine
): {
  readonly unitX: ObservationVector;
  readonly unitY: ObservationVector;
  readonly unitZ: ObservationVector;
} | null {
  const axis1Id = refValue(operator['Axis1']);
  const axis2Id = refValue(operator['Axis2']);
  const axis3Id = refValue(operator['Axis3']);
  const rawX = axis1Id === null ? null : readOptionalDirection(reader, axis1Id, [1, 0, 0]);
  const rawY = axis2Id === null ? null : readOptionalDirection(reader, axis2Id, [0, 1, 0]);
  const rawZ = axis3Id === null ? null : readOptionalDirection(reader, axis3Id, [0, 0, 1]);
  if (
    (axis1Id !== null && rawX === null) ||
    (axis2Id !== null && rawY === null) ||
    (axis3Id !== null && rawZ === null)
  ) {
    return null;
  }
  const initialZ = rawZ ?? (rawX !== null && rawY !== null ? cross(rawX, rawY) : [0, 0, 1]);
  const unitZ = normalize(initialZ);
  if (unitZ === null) return null;
  const initialX =
    rawX ??
    (rawY === null
      ? Math.abs(unitZ[0]) < 0.9
        ? ([1, 0, 0] as const)
        : ([0, 1, 0] as const)
      : cross(rawY, unitZ));
  const projection = dot(unitZ, initialX);
  const unitX = normalize([
    initialX[0] - projection * unitZ[0],
    initialX[1] - projection * unitZ[1],
    initialX[2] - projection * unitZ[2],
  ]);
  if (unitX === null) return null;
  const unitY = normalize(rawY ?? cross(unitZ, unitX));
  return unitY === null ? null : { unitX, unitY, unitZ };
}

function transformRepresentationObservation(
  observation: RepresentationObservation,
  transform: Matrix,
  semanticKey: string
): DecodeResult<RepresentationObservation> {
  const determinant = linearDeterminant(transform);
  if (Math.abs(determinant) < 1e-12) {
    return failure('PLACEMENT_FAILURE', 'Mapped representation has a singular transform', {
      semanticKey,
    });
  }
  const uniformScale = uniformScaleOf(transform);
  const hasScaleOnlyDimensions = observation.dimensions?.some(
    ({ name }) => name !== 'envelope-x' && name !== 'envelope-y' && name !== 'envelope-z'
  );
  if (uniformScale === null && hasScaleOnlyDimensions === true) {
    return failure(
      'UNSUPPORTED_REPRESENTATION',
      'Non-uniform mapping of named parametric dimensions is not supported',
      { semanticKey }
    );
  }
  const comparisonSurface: SurfaceObservation = {
    ...observation.comparisonSurface,
    vertices: observation.comparisonSurface.vertices.map((point) =>
      transformPoint(transform, point)
    ),
    triangles:
      determinant < 0
        ? observation.comparisonSurface.triangles.map(([a, b, c]) => [a, c, b])
        : observation.comparisonSurface.triangles,
  };
  let analyticEvidence: AnalyticEvidence | undefined;
  if (observation.analyticEvidence !== undefined) {
    const hasScaledCurveOrSurface =
      observation.analyticEvidence.surfaces.some(({ kind }) => kind === 'cylinder') ||
      observation.analyticEvidence.curves.some(({ kind }) => kind === 'circle');
    if (uniformScale === null && hasScaledCurveOrSurface) {
      return failure(
        'UNSUPPORTED_REPRESENTATION',
        'Non-uniform mapping of circular analytic evidence is not supported',
        { semanticKey }
      );
    }
    analyticEvidence = {
      surfaces: observation.analyticEvidence.surfaces.map((surface) =>
        surface.kind === 'plane'
          ? {
              kind: 'plane',
              point: transformPoint(transform, surface.point),
              normal: transformNormal(transform, surface.normal),
            }
          : {
              kind: 'cylinder',
              origin: transformPoint(transform, surface.origin),
              axis: transformDirection(transform, surface.axis),
              radius: surface.radius * (uniformScale ?? 1),
            }
      ),
      curves: observation.analyticEvidence.curves.map((curve) =>
        curve.kind === 'line'
          ? {
              kind: 'line',
              point: transformPoint(transform, curve.point),
              direction: transformDirection(transform, curve.direction),
              start: transformPoint(transform, curve.start),
              end: transformPoint(transform, curve.end),
            }
          : {
              kind: 'circle',
              center: transformPoint(transform, curve.center),
              normal: transformNormal(transform, curve.normal),
              radius: curve.radius * (uniformScale ?? 1),
            }
      ),
      topology: {
        ...observation.analyticEvidence.topology,
        ...(observation.analyticEvidence.topology.vertices === undefined
          ? {}
          : {
              vertices: observation.analyticEvidence.topology.vertices.map((point) =>
                transformPoint(transform, point)
              ),
            }),
        ...(observation.analyticEvidence.topology.faces === undefined
          ? {}
          : {
              faces: observation.analyticEvidence.topology.faces.map((face) =>
                determinant < 0
                  ? { vertices: [...face.vertices].reverse(), edges: [...face.edges].reverse() }
                  : face
              ),
            }),
      },
    };
  }
  const envelope = componentEnvelope(comparisonSurface.vertices);
  return success({
    comparisonSurface,
    ...(observation.dimensions === undefined
      ? {}
      : {
          dimensions: observation.dimensions.map((dimension) => ({
            ...dimension,
            value:
              dimension.name === 'envelope-x'
                ? envelope[0]
                : dimension.name === 'envelope-y'
                  ? envelope[1]
                  : dimension.name === 'envelope-z'
                    ? envelope[2]
                    : dimension.value * (uniformScale ?? 1),
          })),
        }),
    ...(analyticEvidence === undefined ? {} : { analyticEvidence }),
  });
}

function componentEnvelope(vertices: readonly ObservationVector[]): ObservationVector {
  const minimum: [number, number, number] = [Infinity, Infinity, Infinity];
  const maximum: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const point of vertices) {
    minimum[0] = Math.min(minimum[0], point[0]);
    minimum[1] = Math.min(minimum[1], point[1]);
    minimum[2] = Math.min(minimum[2], point[2]);
    maximum[0] = Math.max(maximum[0], point[0]);
    maximum[1] = Math.max(maximum[1], point[1]);
    maximum[2] = Math.max(maximum[2], point[2]);
  }
  return [maximum[0] - minimum[0], maximum[1] - minimum[1], maximum[2] - minimum[2]];
}

function combineRepresentationObservations(
  observations: readonly RepresentationObservation[]
): RepresentationObservation {
  if (observations.length === 0) throw new Error('cannot combine no representation observations');
  if (observations.length === 1) {
    const observation = observations[0];
    if (observation === undefined) throw new Error('missing representation observation');
    return observation;
  }
  const vertices: ObservationVector[] = [];
  const triangles: [number, number, number][] = [];
  for (const observation of observations) {
    const offset = vertices.length;
    vertices.push(...observation.comparisonSurface.vertices);
    for (const [a, b, c] of observation.comparisonSurface.triangles) {
      triangles.push([a + offset, b + offset, c + offset]);
    }
  }
  const analytic = observations.map(({ analyticEvidence }) => analyticEvidence);
  const hasCompleteAnalyticEvidence = analytic.every(
    (evidence): evidence is AnalyticEvidence => evidence !== undefined
  );
  return {
    comparisonSurface: {
      unit: 'millimetre',
      vertices,
      triangles,
      closed: observations.every(({ comparisonSurface }) => comparisonSurface.closed),
    },
    ...(hasCompleteAnalyticEvidence
      ? {
          analyticEvidence: {
            surfaces: analytic.flatMap(({ surfaces }) => surfaces),
            curves: analytic.flatMap(({ curves }) => curves),
            topology: {
              vertexCount: analytic.reduce((sum, { topology }) => sum + topology.vertexCount, 0),
              edgeCount: analytic.reduce((sum, { topology }) => sum + topology.edgeCount, 0),
              faceCount: analytic.reduce((sum, { topology }) => sum + topology.faceCount, 0),
              closed: analytic.every(({ topology }) => topology.closed),
            },
          },
        }
      : {}),
  };
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

function identityMatrix(): Matrix {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function invertAffine(matrix: Matrix): Matrix | null {
  const a00 = matrix[0];
  const a01 = matrix[4];
  const a02 = matrix[8];
  const a10 = matrix[1];
  const a11 = matrix[5];
  const a12 = matrix[9];
  const a20 = matrix[2];
  const a21 = matrix[6];
  const a22 = matrix[10];
  const determinant = linearDeterminant(matrix);
  if (Math.abs(determinant) < 1e-12) return null;
  const inverse00 = (a11 * a22 - a12 * a21) / determinant;
  const inverse01 = (a02 * a21 - a01 * a22) / determinant;
  const inverse02 = (a01 * a12 - a02 * a11) / determinant;
  const inverse10 = (a12 * a20 - a10 * a22) / determinant;
  const inverse11 = (a00 * a22 - a02 * a20) / determinant;
  const inverse12 = (a02 * a10 - a00 * a12) / determinant;
  const inverse20 = (a10 * a21 - a11 * a20) / determinant;
  const inverse21 = (a01 * a20 - a00 * a21) / determinant;
  const inverse22 = (a00 * a11 - a01 * a10) / determinant;
  const tx = matrix[12];
  const ty = matrix[13];
  const tz = matrix[14];
  return [
    inverse00,
    inverse10,
    inverse20,
    0,
    inverse01,
    inverse11,
    inverse21,
    0,
    inverse02,
    inverse12,
    inverse22,
    0,
    -(inverse00 * tx + inverse01 * ty + inverse02 * tz),
    -(inverse10 * tx + inverse11 * ty + inverse12 * tz),
    -(inverse20 * tx + inverse21 * ty + inverse22 * tz),
    1,
  ];
}

function linearDeterminant(matrix: Matrix): number {
  return (
    matrix[0] * (matrix[5] * matrix[10] - matrix[9] * matrix[6]) -
    matrix[4] * (matrix[1] * matrix[10] - matrix[9] * matrix[2]) +
    matrix[8] * (matrix[1] * matrix[6] - matrix[5] * matrix[2])
  );
}

function transformPoint(matrix: Matrix, point: ObservationVector): ObservationVector {
  return [
    matrix[0] * point[0] + matrix[4] * point[1] + matrix[8] * point[2] + matrix[12],
    matrix[1] * point[0] + matrix[5] * point[1] + matrix[9] * point[2] + matrix[13],
    matrix[2] * point[0] + matrix[6] * point[1] + matrix[10] * point[2] + matrix[14],
  ];
}

function transformDirection(matrix: Matrix, direction: ObservationVector): ObservationVector {
  const transformed = normalize([
    matrix[0] * direction[0] + matrix[4] * direction[1] + matrix[8] * direction[2],
    matrix[1] * direction[0] + matrix[5] * direction[1] + matrix[9] * direction[2],
    matrix[2] * direction[0] + matrix[6] * direction[1] + matrix[10] * direction[2],
  ]);
  if (transformed === null) throw new Error('mapped direction is degenerate');
  return transformed;
}

function transformNormal(matrix: Matrix, normal: ObservationVector): ObservationVector {
  const inverse = invertAffine(matrix);
  if (inverse === null) throw new Error('mapped normal transform is singular');
  const transformed = normalize([
    inverse[0] * normal[0] + inverse[1] * normal[1] + inverse[2] * normal[2],
    inverse[4] * normal[0] + inverse[5] * normal[1] + inverse[6] * normal[2],
    inverse[8] * normal[0] + inverse[9] * normal[1] + inverse[10] * normal[2],
  ]);
  if (transformed === null) throw new Error('mapped normal is degenerate');
  return transformed;
}

function uniformScaleOf(matrix: Matrix): number | null {
  const scaleX = Math.hypot(matrix[0], matrix[1], matrix[2]);
  const scaleY = Math.hypot(matrix[4], matrix[5], matrix[6]);
  const scaleZ = Math.hypot(matrix[8], matrix[9], matrix[10]);
  const tolerance = 1e-8 * Math.max(1, scaleX, scaleY, scaleZ);
  return Math.abs(scaleX - scaleY) <= tolerance && Math.abs(scaleX - scaleZ) <= tolerance
    ? scaleX
    : null;
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
