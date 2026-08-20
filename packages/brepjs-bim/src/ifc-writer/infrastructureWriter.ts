import * as WebIFC from 'web-ifc';
import type { IfcGuid } from '../identity/ifcGuid.js';
import type {
  BridgePartSpec,
  BridgeSpec,
  EarthworksFillSpec,
  MemberSpec,
  PrismaticInfrastructureSpec,
  SignSpec,
} from '../specs/infrastructureSpec.js';
import { memberBodySpec } from '../elementFns/memberFns.js';
import { writeAxis2Placement3D } from './headerWriter.js';
import type { IfcWriter } from './ifcWriter.js';
import { writeBeamGeometry } from './geometryWriter.js';
import { writeMeshTessellation } from './tessellationWriter.js';
import type { ProductBody } from '../types/productBody.js';

function writeSpatialPlacement(
  w: IfcWriter,
  spec: {
    readonly origin: [number, number, number];
    readonly axisX: [number, number, number];
    readonly axisZ: [number, number, number];
  },
  parentPlacementId: number | null
): number {
  const axisPlacementId = writeAxis2Placement3D(
    w,
    spec.origin.map((value) => w.serializationContext.lengthFromMm(value)) as [
      number,
      number,
      number,
    ],
    spec.axisZ,
    spec.axisX
  );
  const localPlacementId = w.nextId();
  w.writeLine({
    expressID: localPlacementId,
    type: WebIFC.IFCLOCALPLACEMENT,
    PlacementRelTo: parentPlacementId === null ? null : w.ref(parentPlacementId),
    RelativePlacement: w.ref(axisPlacementId),
  });
  return localPlacementId;
}

export function writeBridge(
  w: IfcWriter,
  guid: IfcGuid,
  spec: BridgeSpec,
  ownerHistoryId: number,
  parentPlacementId: number | null
): { readonly entityId: number; readonly placementId: number } {
  const placementId = writeSpatialPlacement(w, spec, parentPlacementId);
  const entityId = w.nextId();
  w.writeLine({
    expressID: entityId,
    type: WebIFC.IFCBRIDGE,
    GlobalId: w.mkType(WebIFC.IFCGLOBALLYUNIQUEID, guid),
    OwnerHistory: w.ref(ownerHistoryId),
    Name: w.mkType(WebIFC.IFCLABEL, spec.name),
    Description: spec.description ? w.mkType(WebIFC.IFCTEXT, spec.description) : null,
    ObjectType: null,
    ObjectPlacement: w.ref(placementId),
    Representation: null,
    LongName: null,
    CompositionType: { type: 3, value: spec.compositionType ?? 'ELEMENT' },
    PredefinedType: { type: 3, value: spec.predefinedType ?? 'NOTDEFINED' },
  });
  return { entityId, placementId };
}

export function writeBridgePart(
  w: IfcWriter,
  guid: IfcGuid,
  spec: BridgePartSpec,
  ownerHistoryId: number,
  parentPlacementId: number | null
): { readonly entityId: number; readonly placementId: number } {
  const placementId = writeSpatialPlacement(w, spec, parentPlacementId);
  const entityId = w.nextId();
  w.writeLine({
    expressID: entityId,
    type: WebIFC.IFCBRIDGEPART,
    GlobalId: w.mkType(WebIFC.IFCGLOBALLYUNIQUEID, guid),
    OwnerHistory: w.ref(ownerHistoryId),
    Name: w.mkType(WebIFC.IFCLABEL, spec.name),
    Description: spec.description ? w.mkType(WebIFC.IFCTEXT, spec.description) : null,
    ObjectType: null,
    ObjectPlacement: w.ref(placementId),
    Representation: null,
    LongName: null,
    CompositionType: { type: 3, value: spec.compositionType ?? 'ELEMENT' },
    UsageType: { type: 3, value: spec.usageType },
    PredefinedType: { type: 3, value: spec.predefinedType ?? 'NOTDEFINED' },
  });
  return { entityId, placementId };
}

export function writeMemberGeometry(
  w: IfcWriter,
  spec: PrismaticInfrastructureSpec,
  productBody: ProductBody,
  geomSubContextId: number,
  parentPlacementId: number | null
): { readonly localPlacementId: number; readonly productDefinitionShapeId: number } {
  if (productBody.kind === 'TESSELLATED') {
    const localPlacementId = writeSpatialPlacement(w, spec, parentPlacementId);
    const tessellation = writeMeshTessellation(w, productBody.mesh, geomSubContextId);
    return { localPlacementId, productDefinitionShapeId: tessellation.productDefinitionShapeId };
  }
  return writeBeamGeometry(w, memberBodySpec(spec), geomSubContextId, parentPlacementId);
}

/** Write an evaluated Product Body with its resolved local Frame under any typed product. */
export function writeProductBodyTessellation(
  w: IfcWriter,
  spec: {
    readonly origin: [number, number, number];
    readonly axisX: [number, number, number];
    readonly axisZ: [number, number, number];
  },
  productBody: Extract<ProductBody, { readonly kind: 'TESSELLATED' }>,
  geomSubContextId: number,
  parentPlacementId: number | null
): { readonly localPlacementId: number; readonly productDefinitionShapeId: number } {
  const localPlacementId = writeSpatialPlacement(w, spec, parentPlacementId);
  const tessellation = writeMeshTessellation(w, productBody.mesh, geomSubContextId);
  return { localPlacementId, productDefinitionShapeId: tessellation.productDefinitionShapeId };
}

function writePrismaticInfrastructureEntity(
  w: IfcWriter,
  entityType: number,
  guid: IfcGuid,
  spec: MemberSpec | SignSpec | EarthworksFillSpec,
  ownerHistoryId: number,
  localPlacementId: number,
  productDefinitionShapeId: number
): number {
  const entityId = w.nextId();
  w.writeLine({
    expressID: entityId,
    type: entityType,
    GlobalId: w.mkType(WebIFC.IFCGLOBALLYUNIQUEID, guid),
    OwnerHistory: w.ref(ownerHistoryId),
    Name: w.mkType(WebIFC.IFCLABEL, spec.name),
    Description: null,
    ObjectType: null,
    ObjectPlacement: w.ref(localPlacementId),
    Representation: w.ref(productDefinitionShapeId),
    Tag: null,
    PredefinedType: { type: 3, value: spec.predefinedType ?? 'NOTDEFINED' },
  });
  return entityId;
}

export function writeMemberEntity(
  w: IfcWriter,
  guid: IfcGuid,
  spec: MemberSpec,
  ownerHistoryId: number,
  localPlacementId: number,
  productDefinitionShapeId: number
): number {
  return writePrismaticInfrastructureEntity(
    w,
    WebIFC.IFCMEMBER,
    guid,
    spec,
    ownerHistoryId,
    localPlacementId,
    productDefinitionShapeId
  );
}

export function writeSignEntity(
  w: IfcWriter,
  guid: IfcGuid,
  spec: SignSpec,
  ownerHistoryId: number,
  localPlacementId: number,
  productDefinitionShapeId: number
): number {
  return writePrismaticInfrastructureEntity(
    w,
    WebIFC.IFCSIGN,
    guid,
    spec,
    ownerHistoryId,
    localPlacementId,
    productDefinitionShapeId
  );
}

export function writeEarthworksFillEntity(
  w: IfcWriter,
  guid: IfcGuid,
  spec: EarthworksFillSpec,
  ownerHistoryId: number,
  localPlacementId: number,
  productDefinitionShapeId: number
): number {
  return writePrismaticInfrastructureEntity(
    w,
    WebIFC.IFCEARTHWORKSFILL,
    guid,
    spec,
    ownerHistoryId,
    localPlacementId,
    productDefinitionShapeId
  );
}
