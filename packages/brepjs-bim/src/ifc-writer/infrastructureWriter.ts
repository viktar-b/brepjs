import * as WebIFC from 'web-ifc';
import type { IfcGuid } from '../identity/ifcGuid.js';
import type { BridgePartSpec, BridgeSpec, MemberSpec } from '../specs/infrastructureSpec.js';
import { memberBodySpec } from '../elementFns/memberFns.js';
import { toIfcLengthM } from '../units/units.js';
import { writeAxis2Placement3D } from './headerWriter.js';
import type { IfcWriter } from './ifcWriter.js';
import { writeBeamGeometry } from './geometryWriter.js';

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
    spec.origin.map(toIfcLengthM) as [number, number, number],
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
    CompositionType: { type: 3, value: 'ELEMENT' },
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
    CompositionType: { type: 3, value: 'ELEMENT' },
    UsageType: { type: 3, value: spec.usageType },
    PredefinedType: { type: 3, value: spec.predefinedType ?? 'NOTDEFINED' },
  });
  return { entityId, placementId };
}

export function writeMemberGeometry(
  w: IfcWriter,
  spec: MemberSpec,
  geomSubContextId: number,
  parentPlacementId: number | null
): { readonly localPlacementId: number; readonly productDefinitionShapeId: number } {
  return writeBeamGeometry(w, memberBodySpec(spec), geomSubContextId, parentPlacementId);
}

export function writeMemberEntity(
  w: IfcWriter,
  guid: IfcGuid,
  spec: MemberSpec,
  ownerHistoryId: number,
  localPlacementId: number,
  productDefinitionShapeId: number
): number {
  const entityId = w.nextId();
  w.writeLine({
    expressID: entityId,
    type: WebIFC.IFCMEMBER,
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
