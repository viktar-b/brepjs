import { describe, it, expect } from 'vitest';
import {
  IFC_SCHEMAS,
  DEFAULT_IFC_SCHEMA,
  IFC4X3_ADD2_REFERENCE_VIEW,
  fileSchemaString,
  isIfc4x3Add2ReferenceView,
  isIfcSchema,
  schemaSupports,
  webIfcSchemaString,
  type IfcSchema,
} from '../src/ifc-writer/schemaVersion.js';

describe('IfcSchema constants', () => {
  it('lists the exact ADD2 contract without removing existing schemas', () => {
    expect(IFC_SCHEMAS).toEqual(['IFC4', 'IFC4X3', 'IFC4X3_ADD2']);
  });

  it('defaults to IFC4', () => {
    expect(DEFAULT_IFC_SCHEMA).toBe('IFC4');
  });
});

describe('fileSchemaString', () => {
  it('returns the FILE_SCHEMA token for IFC4', () => {
    expect(fileSchemaString('IFC4')).toBe('IFC4');
  });

  it('returns the FILE_SCHEMA token for IFC4X3', () => {
    expect(fileSchemaString('IFC4X3')).toBe('IFC4X3');
  });

  it('keeps the exact ADD2 token through the web-ifc runtime boundary', () => {
    expect(fileSchemaString('IFC4X3_ADD2')).toBe('IFC4X3_ADD2');
    expect(webIfcSchemaString('IFC4X3_ADD2')).toBe('IFC4X3_ADD2');
    expect(webIfcSchemaString('IFC4')).toBe('IFC4');
  });
});

describe('isIfcSchema', () => {
  it('accepts supported schema strings', () => {
    expect(isIfcSchema('IFC4')).toBe(true);
    expect(isIfcSchema('IFC4X3')).toBe(true);
    expect(isIfcSchema('IFC4X3_ADD2')).toBe(true);
  });

  it('rejects unsupported or malformed strings', () => {
    expect(isIfcSchema('IFC2X3')).toBe(false);
    expect(isIfcSchema('ifc4')).toBe(false);
    expect(isIfcSchema('')).toBe(false);
    expect(isIfcSchema(undefined)).toBe(false);
    expect(isIfcSchema(42)).toBe(false);
  });
});

describe('schemaSupports', () => {
  it('reports an IFC4-only entity as supported in IFC4 and not IFC4X3', () => {
    // IfcBuildingSystem replaces IfcZone-style grouping changes; IfcBuilding
    // representation differs. We use a representative IFC4-only entity name.
    expect(schemaSupports('IFC4', 'IfcBuildingElementProxy')).toBe(true);
  });

  it('reports an IFC4X3-only entity as supported only in IFC4X3', () => {
    // IfcAlignment and related linear-infrastructure entities are new in IFC4X3.
    expect(schemaSupports('IFC4X3', 'IfcAlignment')).toBe(true);
    expect(schemaSupports('IFC4', 'IfcAlignment')).toBe(false);
    expect(schemaSupports('IFC4X3', 'IfcBridgePart')).toBe(true);
    expect(schemaSupports('IFC4X3_ADD2', 'IfcBridgePart')).toBe(true);
    expect(schemaSupports('IFC4', 'IfcBridgePart')).toBe(false);
  });

  it('reports a shared entity as supported in both schemas', () => {
    expect(schemaSupports('IFC4', 'IfcWall')).toBe(true);
    expect(schemaSupports('IFC4X3', 'IfcWall')).toBe(true);
  });

  it('treats unknown entity names as supported (open-world default)', () => {
    expect(schemaSupports('IFC4', 'IfcSomethingNotTracked')).toBe(true);
    expect(schemaSupports('IFC4X3', 'IfcSomethingNotTracked')).toBe(true);
  });
});

describe('IFC4X3_ADD2 Reference View provenance', () => {
  it('accepts only the exact schema and Reference View pair', () => {
    expect(IFC4X3_ADD2_REFERENCE_VIEW).toBe('ReferenceView');
    expect(
      isIfc4x3Add2ReferenceView({
        schema: 'IFC4X3_ADD2',
        viewDefinition: 'ReferenceView',
      })
    ).toBe(true);
    expect(
      isIfc4x3Add2ReferenceView({
        schema: 'IFC4X3',
        viewDefinition: IFC4X3_ADD2_REFERENCE_VIEW,
      })
    ).toBe(false);
    expect(
      isIfc4x3Add2ReferenceView({
        schema: 'IFC4X3_ADD2',
        viewDefinition: 'DesignTransferView_V1.0',
      })
    ).toBe(false);
  });
});

describe('IfcSchema type', () => {
  it('every IFC_SCHEMAS member is a valid IfcSchema', () => {
    for (const s of IFC_SCHEMAS) {
      const typed: IfcSchema = s;
      expect(isIfcSchema(typed)).toBe(true);
    }
  });
});
