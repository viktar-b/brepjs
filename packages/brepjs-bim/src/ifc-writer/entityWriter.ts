import * as WebIFC from 'web-ifc';
import type { IfcWriter } from './ifcWriter.js';
import { writeAxis2Placement3D } from './headerWriter.js';
import type { IfcGuid } from '../identity/ifcGuid.js';
import type { IfcElementCompositionType } from '../specs/spatialSpec.js';

export function writeProject(
  w: IfcWriter,
  guid: IfcGuid,
  name: string,
  ownerHistoryId: number,
  unitAssignmentId: number,
  geomContextId: number
): number {
  const id = w.nextId();
  w.writeLine({
    expressID: id,
    type: WebIFC.IFCPROJECT,
    GlobalId: w.mkType(WebIFC.IFCGLOBALLYUNIQUEID, guid),
    OwnerHistory: w.ref(ownerHistoryId),
    Name: w.mkType(WebIFC.IFCLABEL, name),
    Description: null,
    ObjectType: null,
    LongName: null,
    Phase: null,
    RepresentationContexts: [w.ref(geomContextId)],
    UnitsInContext: w.ref(unitAssignmentId),
  });
  return id;
}

export function writeSite(
  w: IfcWriter,
  guid: IfcGuid,
  name: string,
  ownerHistoryId: number,
  placement?: {
    readonly origin?: [number, number, number] | undefined;
    readonly axisX?: [number, number, number] | undefined;
    readonly axisZ?: [number, number, number] | undefined;
    readonly compositionType?: IfcElementCompositionType | undefined;
  },
  parentPlacementId: number | null = null
): { entityId: number; placementId: number } {
  const placement3DId = writeAxis2Placement3D(
    w,
    (placement?.origin ?? [0, 0, 0]).map((value) => w.serializationContext.lengthFromMm(value)) as [
      number,
      number,
      number,
    ],
    placement?.axisZ,
    placement?.axisX
  );
  const localPlacementId = w.nextId();
  w.writeLine({
    expressID: localPlacementId,
    type: WebIFC.IFCLOCALPLACEMENT,
    PlacementRelTo: parentPlacementId === null ? null : w.ref(parentPlacementId),
    RelativePlacement: w.ref(placement3DId),
  });
  const entityId = w.nextId();
  w.writeLine({
    expressID: entityId,
    type: WebIFC.IFCSITE,
    GlobalId: w.mkType(WebIFC.IFCGLOBALLYUNIQUEID, guid),
    OwnerHistory: w.ref(ownerHistoryId),
    Name: w.mkType(WebIFC.IFCLABEL, name),
    Description: null,
    ObjectType: null,
    ObjectPlacement: w.ref(localPlacementId),
    Representation: null,
    LongName: null,
    CompositionType: { type: 3, value: placement?.compositionType ?? 'ELEMENT' },
    RefLatitude: null,
    RefLongitude: null,
    RefElevation: null,
    LandTitleNumber: null,
    SiteAddress: null,
  });
  return { entityId, placementId: localPlacementId };
}

export function writeBuilding(
  w: IfcWriter,
  guid: IfcGuid,
  name: string,
  ownerHistoryId: number,
  parentPlacementId: number | null
): { entityId: number; placementId: number } {
  const placement3DId = writeAxis2Placement3D(w, [0, 0, 0]);
  const localPlacementId = w.nextId();
  w.writeLine({
    expressID: localPlacementId,
    type: WebIFC.IFCLOCALPLACEMENT,
    PlacementRelTo: parentPlacementId !== null ? w.ref(parentPlacementId) : null,
    RelativePlacement: w.ref(placement3DId),
  });
  const entityId = w.nextId();
  w.writeLine({
    expressID: entityId,
    type: WebIFC.IFCBUILDING,
    GlobalId: w.mkType(WebIFC.IFCGLOBALLYUNIQUEID, guid),
    OwnerHistory: w.ref(ownerHistoryId),
    Name: w.mkType(WebIFC.IFCLABEL, name),
    Description: null,
    ObjectType: null,
    ObjectPlacement: w.ref(localPlacementId),
    Representation: null,
    LongName: null,
    CompositionType: { type: 3, value: 'ELEMENT' },
    ElevationOfRefHeight: null,
    ElevationOfTerrain: null,
    BuildingAddress: null,
  });
  return { entityId, placementId: localPlacementId };
}

export function writeStorey(
  w: IfcWriter,
  guid: IfcGuid,
  name: string,
  elevationMm: number,
  ownerHistoryId: number,
  parentPlacementId: number | null
): { entityId: number; placementId: number } {
  const elevation = w.serializationContext.lengthFromMm(elevationMm);
  const placement3DId = writeAxis2Placement3D(w, [0, 0, elevation]);
  const localPlacementId = w.nextId();
  w.writeLine({
    expressID: localPlacementId,
    type: WebIFC.IFCLOCALPLACEMENT,
    PlacementRelTo: parentPlacementId !== null ? w.ref(parentPlacementId) : null,
    RelativePlacement: w.ref(placement3DId),
  });
  const entityId = w.nextId();
  w.writeLine({
    expressID: entityId,
    type: WebIFC.IFCBUILDINGSTOREY,
    GlobalId: w.mkType(WebIFC.IFCGLOBALLYUNIQUEID, guid),
    OwnerHistory: w.ref(ownerHistoryId),
    Name: w.mkType(WebIFC.IFCLABEL, name),
    Description: null,
    ObjectType: null,
    ObjectPlacement: w.ref(localPlacementId),
    Representation: null,
    LongName: null,
    CompositionType: { type: 3, value: 'ELEMENT' },
    Elevation: w.mkType(WebIFC.IFCLENGTHMEASURE, elevation),
  });
  return { entityId, placementId: localPlacementId };
}

export function writeWallEntity(
  w: IfcWriter,
  guid: IfcGuid,
  name: string,
  ownerHistoryId: number,
  localPlacementId: number,
  productDefinitionShapeId: number
): number {
  const id = w.nextId();
  w.writeLine({
    expressID: id,
    type: WebIFC.IFCWALL,
    GlobalId: w.mkType(WebIFC.IFCGLOBALLYUNIQUEID, guid),
    OwnerHistory: w.ref(ownerHistoryId),
    Name: w.mkType(WebIFC.IFCLABEL, name),
    Description: null,
    ObjectType: null,
    ObjectPlacement: w.ref(localPlacementId),
    Representation: w.ref(productDefinitionShapeId),
    Tag: null,
    PredefinedType: null,
  });
  return id;
}

export function writeSlabEntity(
  w: IfcWriter,
  guid: IfcGuid,
  name: string,
  _predefinedType: 'FLOOR' | 'ROOF' | 'LANDING' | 'BASESLAB',
  ownerHistoryId: number,
  localPlacementId: number,
  productDefinitionShapeId: number
): number {
  const id = w.nextId();
  w.writeLine({
    expressID: id,
    type: WebIFC.IFCSLAB,
    GlobalId: w.mkType(WebIFC.IFCGLOBALLYUNIQUEID, guid),
    OwnerHistory: w.ref(ownerHistoryId),
    Name: w.mkType(WebIFC.IFCLABEL, name),
    Description: null,
    ObjectType: null,
    ObjectPlacement: w.ref(localPlacementId),
    Representation: w.ref(productDefinitionShapeId),
    Tag: null,
    // Carried by the paired type object (OJT001): occurrence stays empty.
    PredefinedType: null,
  });
  return id;
}

export type BeamPredefinedTypeIfc =
  | 'BEAM'
  | 'JOIST'
  | 'LINTEL'
  | 'HOLLOWCORE'
  | 'PURLIN'
  | 'RAFTER'
  | 'SPANDREL'
  | 'T_BEAM'
  | 'NOTDEFINED';

export function writeBeamEntity(
  w: IfcWriter,
  guid: IfcGuid,
  name: string,
  _predefinedType: BeamPredefinedTypeIfc,
  ownerHistoryId: number,
  localPlacementId: number,
  productDefinitionShapeId: number
): number {
  const id = w.nextId();
  w.writeLine({
    expressID: id,
    type: WebIFC.IFCBEAM,
    GlobalId: w.mkType(WebIFC.IFCGLOBALLYUNIQUEID, guid),
    OwnerHistory: w.ref(ownerHistoryId),
    Name: w.mkType(WebIFC.IFCLABEL, name),
    Description: null,
    ObjectType: null,
    ObjectPlacement: w.ref(localPlacementId),
    Representation: w.ref(productDefinitionShapeId),
    Tag: null,
    // Carried by the paired type object (OJT001): occurrence stays empty.
    PredefinedType: null,
  });
  return id;
}

export type ColumnPredefinedTypeIfc = 'COLUMN' | 'PILASTER' | 'NOTDEFINED';

export function writeColumnEntity(
  w: IfcWriter,
  guid: IfcGuid,
  name: string,
  _predefinedType: ColumnPredefinedTypeIfc,
  ownerHistoryId: number,
  localPlacementId: number,
  productDefinitionShapeId: number
): number {
  const id = w.nextId();
  w.writeLine({
    expressID: id,
    type: WebIFC.IFCCOLUMN,
    GlobalId: w.mkType(WebIFC.IFCGLOBALLYUNIQUEID, guid),
    OwnerHistory: w.ref(ownerHistoryId),
    Name: w.mkType(WebIFC.IFCLABEL, name),
    Description: null,
    ObjectType: null,
    ObjectPlacement: w.ref(localPlacementId),
    Representation: w.ref(productDefinitionShapeId),
    Tag: null,
    // Carried by the paired type object (OJT001): occurrence stays empty.
    PredefinedType: null,
  });
  return id;
}
