import { describe, expect, it } from 'vitest';
import { unwrap } from 'brepjs';
import { issue } from '../src/validation/severity.js';
import {
  BRIDGE_VALIDATION_GATES,
  buildBridgeValidationReport,
  classifyBridgeValidationExit,
  serializeBridgeValidationReport,
  type BridgeGateResultInput,
  type BridgeValidationInput,
} from '../src/validation/bridgeValidationContract.js';

const VALIDATORS = [
  { id: 'brepjs-bim', name: 'brepjs-bim local validators', version: '0.16.1' },
  { id: 'ifcopenshell', name: 'IfcOpenShell', version: '0.8.3' },
  { id: 'web-ifc', name: 'web-ifc', version: '0.0.77' },
] as const;

function passingProjectResults(): BridgeGateResultInput[] {
  return BRIDGE_VALIDATION_GATES.filter((gate) => gate.required).map((gate) => ({
    gateId: gate.id,
    status: 'pass',
    validatorId: gate.id === 'ifc.parse' ? 'web-ifc' : 'brepjs-bim',
    issues: [],
    evidence: [{ kind: 'model', value: gate.id }],
  }));
}

function input(
  gateResults: readonly BridgeGateResultInput[] = passingProjectResults()
): BridgeValidationInput {
  return {
    ifcSchema: 'IFC4X3_ADD2',
    ifcView: 'ReferenceView',
    modelHash: { algorithm: 'sha256', value: 'a'.repeat(64) },
    validators: VALIDATORS,
    gateResults,
  };
}

describe('bim/bridge/v1 Validation Contract report', () => {
  it('emits fixed provenance, ordered gates, and complete per-gate fields', () => {
    const report = unwrap(buildBridgeValidationReport(input()));

    expect(report.schemaVersion).toBe('1');
    expect(report.scaffoldContract).toBe('bim/bridge/v1');
    expect(report.ifc).toEqual({ schema: 'IFC4X3_ADD2', view: 'ReferenceView' });
    expect(report.modelHash).toEqual({ algorithm: 'sha256', value: 'a'.repeat(64) });
    expect(report.validators).toEqual([...VALIDATORS]);
    expect(report.gates.map((gate) => gate.id)).toEqual(
      BRIDGE_VALIDATION_GATES.map((gate) => gate.id)
    );
    expect(new Set(report.gates.map((gate) => gate.evidenceLayer))).toEqual(
      new Set(['project', 'independent', 'reference'])
    );
    for (const gate of report.gates) {
      expect(gate).toHaveProperty('id');
      expect(gate).toHaveProperty('evidenceLayer');
      expect(gate).toHaveProperty('required');
      expect(gate).toHaveProperty('status');
      expect(gate).toHaveProperty('issues');
      expect(gate).toHaveProperty('evidence');
    }
    expect(report.summary.gates).toEqual({
      pass: BRIDGE_VALIDATION_GATES.filter((gate) => gate.required).length,
      fail: 0,
      unavailable: 0,
      'not-applicable': BRIDGE_VALIDATION_GATES.filter((gate) => !gate.required).length,
    });
    expect(report.summary.exitClassification).toBe(0);
    expect(report.gates.find((gate) => gate.id === 'ifc.parse')?.validatorId).toBe('web-ifc');
    expect(report.summary.issues).toEqual({ error: 0, warning: 0, info: 0 });
  });

  it('keeps pass, fail, unavailable, and not-applicable distinct', () => {
    const results = passingProjectResults();
    const failingId = BRIDGE_VALIDATION_GATES.find((gate) => gate.required)?.id;
    if (failingId === undefined) throw new Error('required gate missing');
    const report = unwrap(
      buildBridgeValidationReport(
        input([
          ...results.filter((result) => result.gateId !== failingId),
          {
            gateId: failingId,
            status: 'fail',
            validatorId: 'brepjs-bim',
            issues: [issue('error', 'TEST_FAILURE', 'Deliberate failure')],
            evidence: [{ kind: 'model', value: 'failing-model' }],
          },
          {
            gateId: 'independent.ifcopenshell.parse',
            status: 'unavailable',
            validatorId: 'ifcopenshell',
            unavailableReason: 'missing',
            issues: [issue('warning', 'VALIDATOR_MISSING', 'IfcOpenShell is not installed')],
            evidence: [],
          },
        ])
      )
    );

    expect(new Set(report.gates.map((gate) => gate.status))).toEqual(
      new Set(['pass', 'fail', 'unavailable', 'not-applicable'])
    );
    expect(classifyBridgeValidationExit(report)).toBe(1);
    expect(report.summary.exitClassification).toBe(1);
  });

  it('classifies missing or unavailable required evidence as exit 2, never pass', () => {
    const required = BRIDGE_VALIDATION_GATES.filter((gate) => gate.required);
    const missingId = required[0]?.id;
    const crashedId = required[1]?.id;
    if (missingId === undefined || crashedId === undefined)
      throw new Error('required gates missing');
    const results = passingProjectResults().filter(
      (result) => result.gateId !== missingId && result.gateId !== crashedId
    );
    results.push({
      gateId: crashedId,
      status: 'unavailable',
      validatorId: 'brepjs-bim',
      unavailableReason: 'crashed',
      issues: [issue('error', 'VALIDATOR_CRASHED', 'Validator crashed')],
      evidence: [],
    });
    const report = unwrap(buildBridgeValidationReport(input(results)));

    expect(report.gates.find((gate) => gate.id === missingId)?.status).toBe('unavailable');
    expect(report.gates.find((gate) => gate.id === crashedId)?.status).toBe('unavailable');
    expect(classifyBridgeValidationExit(report)).toBe(2);
    expect(report.summary.exitClassification).toBe(2);
  });

  it('keeps every unavailable cause explicit and non-passing', () => {
    const gateId = BRIDGE_VALIDATION_GATES.find((gate) => gate.required)?.id;
    if (gateId === undefined) throw new Error('required gate missing');
    for (const unavailableReason of ['unsupported', 'skipped', 'missing', 'crashed'] as const) {
      const results = passingProjectResults().filter((result) => result.gateId !== gateId);
      results.push({
        gateId,
        status: 'unavailable',
        validatorId: 'brepjs-bim',
        unavailableReason,
        issues: [issue('warning', 'VALIDATOR_UNAVAILABLE', unavailableReason)],
        evidence: [],
      });
      const report = unwrap(buildBridgeValidationReport(input(results)));
      expect(report.gates.find((gate) => gate.id === gateId)).toMatchObject({
        status: 'unavailable',
        unavailableReason,
      });
      expect(classifyBridgeValidationExit(report)).toBe(2);
    }
  });

  it('normalizes validator, issue, evidence, and input ordering deterministically', () => {
    const results = passingProjectResults().map((result, index) =>
      index === 0
        ? {
            ...result,
            issues: [issue('warning', 'Z_LAST', 'Second'), issue('warning', 'A_FIRST', 'First')],
            evidence: [
              { kind: 'validator', value: 'z' },
              { kind: 'model', value: 'a' },
            ],
          }
        : result
    );
    const forward = unwrap(buildBridgeValidationReport(input(results)));
    const reverse = unwrap(
      buildBridgeValidationReport({
        ...input([...results].reverse()),
        validators: [...VALIDATORS].reverse(),
      })
    );

    expect(serializeBridgeValidationReport(forward)).toBe(serializeBridgeValidationReport(reverse));
    expect(serializeBridgeValidationReport(forward)).toBe(`${JSON.stringify(forward, null, 2)}\n`);
  });

  it('rejects a pass that carries unavailable validator evidence', () => {
    const gateId = BRIDGE_VALIDATION_GATES.find((gate) => gate.required)?.id;
    if (gateId === undefined) throw new Error('required gate missing');
    const malformed = {
      gateId,
      status: 'pass',
      validatorId: 'brepjs-bim',
      unavailableReason: 'unsupported',
      issues: [],
      evidence: [],
    } as unknown as BridgeGateResultInput;

    const result = buildBridgeValidationReport(input([malformed]));
    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_CONTRACT_INPUT' } });
  });
});
