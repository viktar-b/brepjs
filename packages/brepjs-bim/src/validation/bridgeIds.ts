import baselineIdsXml from './requirements/bim-bridge-v1.ids?raw';
import { err, ok, type Result } from 'brepjs';
import type { BimError } from '../errors/bimError.js';
import { specError } from '../errors/bimError.js';
import { checkIdsData } from '../ids/idsEngine.js';
import { parseIdsXml } from '../ids/idsParser.js';
import { issue, type ValidationIssue } from './severity.js';
import type {
  BridgeGateResultInput,
  ValidatorProvenance,
  ValidatorUnavailableReason,
} from './bridgeValidationContract.js';

export const BRIDGE_BASELINE_IDS_XML = baselineIdsXml;
export const BRIDGE_BASELINE_IDS_SHA256 =
  '10654987787ece9243e27b8ece06293b97550efdb9683a1bf92f7e10b8aec4b7';

export const BRIDGE_IDS_VALIDATOR: ValidatorProvenance = Object.freeze({
  id: 'brepjs-bim.ids',
  name: 'brepjs-bim IDS 1.0 checker',
  version: '1',
});

export interface BridgeIdsEvaluationInput {
  readonly ifcBytes: Uint8Array;
  /** Contents read from the generated project's immutable baseline IDS path, or null if absent. */
  readonly baselineIdsXml: string | null;
  /** Contents read from the generated project's additive project IDS path, or null if absent. */
  readonly projectIdsXml: string | null;
}

export interface BridgeIdsEvaluation {
  readonly validator: ValidatorProvenance;
  readonly gateResults: readonly [BridgeGateResultInput, BridgeGateResultInput];
}

/** Evaluates the checksum-bound Bridge baseline and additive project IDS as separate required gates. */
export async function evaluateBridgeIds(
  input: BridgeIdsEvaluationInput
): Promise<Result<BridgeIdsEvaluation, BimError>> {
  try {
    if (
      !(input.ifcBytes instanceof Uint8Array) ||
      (input.baselineIdsXml !== null && typeof input.baselineIdsXml !== 'string') ||
      (input.projectIdsXml !== null && typeof input.projectIdsXml !== 'string')
    ) {
      return err(
        specError('BRIDGE_IDS_INPUT', 'Bridge IDS evaluation input has an invalid runtime shape')
      );
    }
    const baseline = await evaluateBaseline(input.ifcBytes, input.baselineIdsXml);
    const project = await evaluateIdsDocument(
      input.ifcBytes,
      input.projectIdsXml,
      'ids.project',
      'requirements/project.ids'
    );
    return ok(
      Object.freeze({
        validator: BRIDGE_IDS_VALIDATOR,
        gateResults: Object.freeze([baseline, project] as const),
      })
    );
  } catch (cause) {
    return err(specError('BRIDGE_IDS_INPUT', 'Bridge IDS evaluation could not start', cause));
  }
}

async function evaluateBaseline(
  ifcBytes: Uint8Array,
  xml: string | null
): Promise<BridgeGateResultInput> {
  if (xml === null) {
    return unavailableGate(
      'ids.baseline',
      'missing',
      issue(
        'error',
        'BRIDGE_BASELINE_IDS_MISSING',
        'Required baseline IDS requirements/bim-bridge-v1.ids is missing'
      ),
      [
        {
          kind: 'expected-ids-document',
          value: 'requirements/bim-bridge-v1.ids',
          checksum: BRIDGE_BASELINE_IDS_SHA256,
        },
      ]
    );
  }

  let actualChecksum: string;
  try {
    actualChecksum = await sha256Hex(xml);
  } catch {
    return unavailableGate(
      'ids.baseline',
      'crashed',
      issue('error', 'IDS_CHECKSUM_UNAVAILABLE', 'Could not calculate the baseline IDS checksum'),
      []
    );
  }
  if (actualChecksum !== BRIDGE_BASELINE_IDS_SHA256) {
    return {
      gateId: 'ids.baseline',
      status: 'fail',
      validatorId: BRIDGE_IDS_VALIDATOR.id,
      issues: [
        issue(
          'error',
          'BRIDGE_BASELINE_IDS_CHECKSUM_MISMATCH',
          'Baseline IDS differs from the immutable bim/bridge/v1 requirement'
        ),
      ],
      evidence: [
        {
          kind: 'ids-document',
          value: 'requirements/bim-bridge-v1.ids',
          checksum: actualChecksum,
        },
        {
          kind: 'expected-ids-document',
          value: 'bim/bridge/v1',
          checksum: BRIDGE_BASELINE_IDS_SHA256,
        },
      ],
    };
  }
  return evaluateIdsDocument(
    ifcBytes,
    xml,
    'ids.baseline',
    'requirements/bim-bridge-v1.ids',
    actualChecksum
  );
}

async function evaluateIdsDocument(
  ifcBytes: Uint8Array,
  xml: string | null,
  gateId: 'ids.baseline' | 'ids.project',
  path: string,
  knownChecksum?: string
): Promise<BridgeGateResultInput> {
  if (xml === null) {
    return unavailableGate(
      gateId,
      'missing',
      issue('error', 'IDS_DOCUMENT_MISSING', `Required IDS ${path} is missing`),
      []
    );
  }

  let checksum: string;
  try {
    checksum = knownChecksum ?? (await sha256Hex(xml));
  } catch {
    return unavailableGate(
      gateId,
      'crashed',
      issue('error', 'IDS_CHECKSUM_UNAVAILABLE', `Could not calculate the checksum for ${path}`),
      []
    );
  }
  const evidence = [{ kind: 'ids-document', value: path, checksum }] as const;
  const parsed = parseIdsXml(xml);
  if (!parsed.ok) {
    return {
      gateId,
      status: 'fail',
      validatorId: BRIDGE_IDS_VALIDATOR.id,
      issues: [issue('error', parsed.error.code, parsed.error.message)],
      evidence,
    };
  }

  try {
    const checked = await checkIdsData(ifcBytes, parsed.value);
    if (!checked.ok) {
      return unavailableGate(
        gateId,
        'crashed',
        issue('error', checked.error.code, checked.error.message),
        evidence
      );
    }
    if (checked.value.unsupportedFacets.length > 0) {
      return unavailableGate(
        gateId,
        'unsupported',
        issue(
          'error',
          'IDS_FACET_UNSUPPORTED',
          `Required IDS uses unsupported facets: ${checked.value.unsupportedFacets.join(', ')}`
        ),
        evidence
      );
    }
    const issues = checked.value.results.flatMap((result) => result.issues);
    return {
      gateId,
      status: checked.value.pass ? 'pass' : 'fail',
      validatorId: BRIDGE_IDS_VALIDATOR.id,
      issues,
      evidence,
    };
  } catch {
    return unavailableGate(
      gateId,
      'crashed',
      issue('error', 'IDS_VALIDATOR_CRASHED', `IDS evaluation crashed for ${path}`),
      evidence
    );
  }
}

function unavailableGate(
  gateId: 'ids.baseline' | 'ids.project',
  unavailableReason: ValidatorUnavailableReason,
  problem: ValidationIssue,
  evidence: readonly { readonly kind: string; readonly value: string; readonly checksum?: string }[]
): BridgeGateResultInput {
  return {
    gateId,
    status: 'unavailable',
    validatorId: BRIDGE_IDS_VALIDATOR.id,
    unavailableReason,
    issues: [problem],
    evidence,
  };
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
