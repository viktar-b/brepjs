import { err, ok, type Result } from 'brepjs';
import type { BimError } from '../errors/bimError.js';
import { specError } from '../errors/bimError.js';
import { isIfc4x3Add2ReferenceView } from '../ifc-writer/schemaVersion.js';
import type { ValidationIssue, ValidationSeverity, SeverityCounts } from './severity.js';

export const BRIDGE_VALIDATION_REPORT_SCHEMA_VERSION = '1';
export const BRIDGE_SCAFFOLD_CONTRACT = 'bim/bridge/v1';

export type ValidationEvidenceLayer = 'project' | 'independent' | 'reference';
export type ValidationGateStatus = 'pass' | 'fail' | 'unavailable' | 'not-applicable';
export type ValidatorUnavailableReason = 'unsupported' | 'skipped' | 'missing' | 'crashed';
export type BridgeValidationExitClassification = 0 | 1 | 2;

export interface BridgeValidationGateDefinition {
  readonly id: string;
  readonly evidenceLayer: ValidationEvidenceLayer;
  readonly required: boolean;
}

const requiredProjectGate = (id: string): BridgeValidationGateDefinition =>
  Object.freeze({ id, evidenceLayer: 'project' as const, required: true });

const externalGate = (
  id: string,
  evidenceLayer: 'independent' | 'reference'
): BridgeValidationGateDefinition => Object.freeze({ id, evidenceLayer, required: false });

/** Stable execution/report order for the bim/bridge/v1 Validation Contract. */
export const BRIDGE_VALIDATION_GATES: readonly BridgeValidationGateDefinition[] = Object.freeze([
  requiredProjectGate('project.config'),
  requiredProjectGate('project.unit-values'),
  requiredProjectGate('project.semantic-keys'),
  requiredProjectGate('project.identity'),
  requiredProjectGate('project.spatial-semantics'),
  requiredProjectGate('project.starter-inventory'),
  requiredProjectGate('project.spatial-parentage'),
  requiredProjectGate('project.containment'),
  requiredProjectGate('project.acyclic-graphs'),
  requiredProjectGate('project.local-frames'),
  requiredProjectGate('project.family-geometry'),
  requiredProjectGate('project.dimension-bounds'),
  requiredProjectGate('ifc.provenance'),
  requiredProjectGate('ifc.parse'),
  requiredProjectGate('ifc.referential-integrity'),
  requiredProjectGate('ifc.geometry'),
  requiredProjectGate('ifc.normative-rules'),
  requiredProjectGate('ifc.project-units'),
  requiredProjectGate('ifc.map-units'),
  requiredProjectGate('ifc.crs-map-conversion'),
  requiredProjectGate('ifc.deterministic-export'),
  requiredProjectGate('ifc.round-trip'),
  externalGate('independent.ifcopenshell.parse', 'independent'),
  externalGate('independent.ifcopenshell.express-where', 'independent'),
  externalGate('independent.ifcopenshell.geometry', 'independent'),
  externalGate('independent.ifcopenshell.guid-spatial', 'independent'),
  externalGate('reference.spatial-structure', 'reference'),
  externalGate('reference.categories-predefined-types', 'reference'),
  externalGate('reference.composition-subdivision', 'reference'),
  externalGate('reference.containment', 'reference'),
  externalGate('reference.placements-map-conversion', 'reference'),
  externalGate('reference.materials', 'reference'),
  externalGate('reference.quantitative-geometry', 'reference'),
  externalGate('reference.definition-reuse', 'reference'),
  externalGate('reference.identities', 'reference'),
  externalGate('reference.round-trip', 'reference'),
  externalGate('reference.fixed-view-visual', 'reference'),
] as const);

export interface ValidatorProvenance {
  readonly id: string;
  readonly name: string;
  readonly version: string;
}

export interface ValidationEvidenceReference {
  readonly kind: string;
  readonly value: string;
  readonly checksum?: string | undefined;
}

interface BridgeGateResultBase {
  readonly gateId: string;
  readonly validatorId?: string | undefined;
  readonly issues: readonly ValidationIssue[];
  readonly evidence: readonly ValidationEvidenceReference[];
}

export type BridgeGateResultInput =
  | (BridgeGateResultBase & {
      readonly status: 'pass' | 'fail' | 'not-applicable';
      readonly unavailableReason?: never;
    })
  | (BridgeGateResultBase & {
      readonly status: 'unavailable';
      readonly unavailableReason: ValidatorUnavailableReason;
    });

export interface BridgeValidationInput {
  readonly ifcSchema: string;
  readonly ifcView: string;
  readonly modelHash: { readonly algorithm: 'sha256'; readonly value: string };
  readonly validators: readonly ValidatorProvenance[];
  readonly gateResults: readonly BridgeGateResultInput[];
}

export interface BridgeValidationGateResult {
  readonly id: string;
  readonly evidenceLayer: ValidationEvidenceLayer;
  readonly required: boolean;
  readonly status: ValidationGateStatus;
  readonly validatorId: string | null;
  readonly unavailableReason: ValidatorUnavailableReason | null;
  readonly issues: readonly ValidationIssue[];
  readonly evidence: readonly ValidationEvidenceReference[];
}

export interface BridgeValidationSummary {
  readonly gates: Readonly<Record<ValidationGateStatus, number>>;
  readonly issues: SeverityCounts;
  readonly exitClassification: BridgeValidationExitClassification;
}

export interface BridgeValidationReport {
  readonly schemaVersion: typeof BRIDGE_VALIDATION_REPORT_SCHEMA_VERSION;
  readonly scaffoldContract: typeof BRIDGE_SCAFFOLD_CONTRACT;
  readonly ifc: { readonly schema: string; readonly view: string };
  readonly modelHash: { readonly algorithm: 'sha256'; readonly value: string };
  readonly validators: readonly ValidatorProvenance[];
  readonly summary: BridgeValidationSummary;
  readonly gates: readonly BridgeValidationGateResult[];
}

/** Builds the deterministic bim/bridge/v1 report from independently evaluated gates. */
export function buildBridgeValidationReport(
  input: BridgeValidationInput
): Result<BridgeValidationReport, BimError> {
  try {
    const inputError = validateInput(input);
    if (inputError !== null) return err(inputError);

    const resultsById = new Map(input.gateResults.map((result) => [result.gateId, result]));
    const gates = BRIDGE_VALIDATION_GATES.map((definition) =>
      normalizeGate(definition, resultsById.get(definition.id))
    );
    const reportWithoutSummary = {
      schemaVersion: BRIDGE_VALIDATION_REPORT_SCHEMA_VERSION,
      scaffoldContract: BRIDGE_SCAFFOLD_CONTRACT,
      ifc: { schema: input.ifcSchema, view: input.ifcView },
      modelHash: { algorithm: 'sha256' as const, value: input.modelHash.value.toLowerCase() },
      validators: input.validators
        .map((validator) => ({
          id: validator.id,
          name: validator.name,
          version: validator.version,
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      gates,
    } as const;
    const report: BridgeValidationReport = {
      ...reportWithoutSummary,
      summary: summarizeGates(gates),
    };
    return ok(deepFreeze(report));
  } catch (cause) {
    return err(
      specError('VALIDATION_CONTRACT_INPUT', 'Malformed validation contract input', cause)
    );
  }
}

/** Maps a completed report to the generated command's stable 0/1/2 exit contract. */
export function classifyBridgeValidationExit(
  report: Pick<BridgeValidationReport, 'gates'>
): BridgeValidationExitClassification {
  const required = report.gates.filter((gate) => gate.required);
  if (required.some((gate) => gate.status === 'fail')) return 1;
  if (required.some((gate) => gate.status !== 'pass')) return 2;
  return 0;
}

/** Serializes a report with stable indentation and one trailing newline. */
export function serializeBridgeValidationReport(report: BridgeValidationReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

function normalizeGate(
  definition: BridgeValidationGateDefinition,
  input: BridgeGateResultInput | undefined
): BridgeValidationGateResult {
  if (input === undefined) {
    if (!definition.required) {
      return {
        ...definition,
        status: 'not-applicable',
        validatorId: null,
        unavailableReason: null,
        issues: [],
        evidence: [],
      };
    }
    return {
      ...definition,
      status: 'unavailable',
      validatorId: null,
      unavailableReason: 'missing',
      issues: [
        {
          severity: 'error',
          code: 'VALIDATION_EVIDENCE_MISSING',
          message: `Required gate "${definition.id}" did not provide a result`,
        },
      ],
      evidence: [],
    };
  }

  return {
    ...definition,
    status: input.status,
    validatorId: input.validatorId ?? null,
    unavailableReason: input.status === 'unavailable' ? input.unavailableReason : null,
    issues: input.issues.map(normalizeIssue).sort(compareIssues),
    evidence: input.evidence.map(normalizeEvidence).sort(compareEvidence),
  };
}

function summarizeGates(gates: readonly BridgeValidationGateResult[]): BridgeValidationSummary {
  const gateCounts: Record<ValidationGateStatus, number> = {
    pass: 0,
    fail: 0,
    unavailable: 0,
    'not-applicable': 0,
  };
  const issueCounts: Record<ValidationSeverity, number> = { error: 0, warning: 0, info: 0 };
  for (const gate of gates) {
    gateCounts[gate.status] += 1;
    for (const nextIssue of gate.issues) issueCounts[nextIssue.severity] += 1;
  }
  return {
    gates: gateCounts,
    issues: issueCounts,
    exitClassification: classifyBridgeValidationExit({ gates }),
  };
}

function validateInput(input: BridgeValidationInput): BimError | null {
  if (
    typeof input.ifcSchema !== 'string' ||
    typeof input.ifcView !== 'string' ||
    input.modelHash === null ||
    typeof input.modelHash !== 'object' ||
    input.modelHash.algorithm !== 'sha256' ||
    typeof input.modelHash.value !== 'string' ||
    !Array.isArray(input.validators) ||
    !Array.isArray(input.gateResults)
  ) {
    return contractError('Validation report metadata has an invalid runtime shape');
  }
  if (
    !isIfc4x3Add2ReferenceView({
      schema: input.ifcSchema,
      viewDefinition: input.ifcView,
    })
  ) {
    return contractError('Bridge reports require exact IFC4X3_ADD2 Reference View provenance');
  }
  if (!/^[0-9a-fA-F]{64}$/.test(input.modelHash.value)) {
    return contractError('modelHash.value must be a 64-character SHA-256 hexadecimal digest');
  }

  const validators: readonly ValidatorProvenance[] = input.validators;
  const gateResults: readonly BridgeGateResultInput[] = input.gateResults;
  const validatorIds = new Set<string>();
  for (const validator of validators) {
    if (
      validator === null ||
      typeof validator !== 'object' ||
      typeof validator.id !== 'string' ||
      validator.id.length === 0 ||
      typeof validator.name !== 'string' ||
      validator.name.length === 0 ||
      typeof validator.version !== 'string' ||
      validator.version.length === 0 ||
      validatorIds.has(validator.id)
    ) {
      return contractError(`Validator provenance is incomplete or duplicated at "${validator.id}"`);
    }
    validatorIds.add(validator.id);
  }

  const knownGateIds = new Set(BRIDGE_VALIDATION_GATES.map((gate) => gate.id));
  const resultIds = new Set<string>();
  for (const result of gateResults) {
    if (
      result === null ||
      typeof result !== 'object' ||
      typeof result.gateId !== 'string' ||
      !knownGateIds.has(result.gateId) ||
      resultIds.has(result.gateId)
    ) {
      return contractError(`Gate result is unknown or duplicated at "${result.gateId}"`);
    }
    resultIds.add(result.gateId);
    if (
      !['pass', 'fail', 'unavailable', 'not-applicable'].includes(String(result.status)) ||
      !Array.isArray(result.issues) ||
      !Array.isArray(result.evidence)
    ) {
      return contractError(`Gate "${result.gateId}" has an invalid runtime shape`);
    }
    if (
      result.validatorId !== undefined &&
      (typeof result.validatorId !== 'string' || !validatorIds.has(result.validatorId))
    ) {
      return contractError(
        `Gate "${result.gateId}" names unknown validator "${result.validatorId}"`
      );
    }
    const unavailableReason = (result as { readonly unavailableReason?: unknown })
      .unavailableReason;
    if (result.status !== 'unavailable' && unavailableReason !== undefined) {
      return contractError(`Gate "${result.gateId}" cannot pass with unavailable evidence`);
    }
    if (
      result.status === 'unavailable' &&
      !['unsupported', 'skipped', 'missing', 'crashed'].includes(String(unavailableReason))
    ) {
      return contractError(`Unavailable gate "${result.gateId}" requires a reason`);
    }
    if (
      (result.status === 'pass' || result.status === 'fail') &&
      result.validatorId === undefined
    ) {
      return contractError(`Gate "${result.gateId}" requires validator provenance`);
    }
    if (
      result.status === 'pass' &&
      result.issues.some((next: ValidationIssue) => next.severity === 'error')
    ) {
      return contractError(`Passing gate "${result.gateId}" cannot contain error issues`);
    }
    if (
      result.issues.some(
        (next: ValidationIssue) =>
          next === null ||
          typeof next !== 'object' ||
          !['error', 'warning', 'info'].includes(String(next.severity)) ||
          typeof next.code !== 'string' ||
          next.code.length === 0 ||
          typeof next.message !== 'string' ||
          next.message.length === 0 ||
          (next.entity !== undefined &&
            typeof next.entity !== 'string' &&
            typeof next.entity !== 'number') ||
          (next.context !== undefined &&
            (next.context === null ||
              typeof next.context !== 'object' ||
              Array.isArray(next.context)))
      )
    ) {
      return contractError(`Gate "${result.gateId}" contains an invalid issue`);
    }
    if (result.status === 'pass' && result.evidence.length === 0) {
      return contractError(`Passing gate "${result.gateId}" requires evidence`);
    }
    if (
      result.evidence.some(
        (reference: ValidationEvidenceReference) =>
          reference === null ||
          typeof reference !== 'object' ||
          typeof reference.kind !== 'string' ||
          reference.kind.length === 0 ||
          typeof reference.value !== 'string' ||
          reference.value.length === 0 ||
          (reference.checksum !== undefined &&
            (typeof reference.checksum !== 'string' || reference.checksum.length === 0))
      )
    ) {
      return contractError(`Gate "${result.gateId}" contains an incomplete evidence reference`);
    }
  }
  return null;
}

function contractError(message: string): BimError {
  return specError('VALIDATION_CONTRACT_INPUT', message);
}

function compareIssues(left: ValidationIssue, right: ValidationIssue): number {
  const severityRank = { error: 0, warning: 1, info: 2 } as const;
  return (
    severityRank[left.severity] - severityRank[right.severity] ||
    left.code.localeCompare(right.code) ||
    String(left.entity ?? '').localeCompare(String(right.entity ?? '')) ||
    left.message.localeCompare(right.message) ||
    JSON.stringify(left.context ?? {}).localeCompare(JSON.stringify(right.context ?? {}))
  );
}

function compareEvidence(
  left: ValidationEvidenceReference,
  right: ValidationEvidenceReference
): number {
  return (
    left.kind.localeCompare(right.kind) ||
    left.value.localeCompare(right.value) ||
    (left.checksum ?? '').localeCompare(right.checksum ?? '')
  );
}

function normalizeIssue(nextIssue: ValidationIssue): ValidationIssue {
  return {
    severity: nextIssue.severity,
    code: nextIssue.code,
    message: nextIssue.message,
    ...(nextIssue.entity !== undefined ? { entity: nextIssue.entity } : {}),
    ...(nextIssue.context !== undefined ? { context: canonicalizeContext(nextIssue.context) } : {}),
  };
}

function normalizeEvidence(reference: ValidationEvidenceReference): ValidationEvidenceReference {
  return {
    kind: reference.kind,
    value: reference.value,
    ...(reference.checksum !== undefined ? { checksum: reference.checksum } : {}),
  };
}

function canonicalizeContext(
  context: Readonly<Record<string, unknown>>
): Readonly<Record<string, unknown>> {
  return canonicalizeObject(context, new Set<object>());
}

function canonicalizeValue(value: unknown, ancestors: Set<object>): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Validation context numbers must be finite');
    return value;
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new TypeError('Validation context must not contain cycles');
    ancestors.add(value);
    const result = value.map((entry) => canonicalizeValue(entry, ancestors));
    ancestors.delete(value);
    return result;
  }
  if (typeof value === 'object') {
    const prototype = Reflect.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('Validation context must contain only JSON objects');
    }
    return canonicalizeObject(value as Readonly<Record<string, unknown>>, ancestors);
  }
  throw new TypeError('Validation context must contain only JSON values');
}

function canonicalizeObject(
  value: Readonly<Record<string, unknown>>,
  ancestors: Set<object>
): Readonly<Record<string, unknown>> {
  if (ancestors.has(value)) throw new TypeError('Validation context must not contain cycles');
  ancestors.add(value);
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const entry = value[key];
    if (entry !== undefined) result[key] = canonicalizeValue(entry, ancestors);
  }
  ancestors.delete(value);
  return result;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
