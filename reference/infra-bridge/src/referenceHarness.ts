import type {
  ObservedFrame,
  ReconstructionTarget,
  ReferenceRepetitionObservation,
  ReferenceScene,
} from './contracts.js';
import type { ReferenceHarnessError } from './errors.js';
import { referenceHarnessError } from './errors.js';
import { decodeIfcReference, inspectIfcReference } from './ifcReferenceAdapter.js';
import { parametricRepresentationDecoder } from './parametricIfcAdapter.js';
import { tessellatedRepresentationDecoder } from './tessellatedIfcAdapter.js';
import { analyticBrepRepresentationDecoder } from './analyticBrepIfcAdapter.js';

export interface ReferenceManifestMapping {
  readonly semanticKey: string;
  readonly referenceGlobalId: string;
}

/** Checksummed, authored identity mapping for selecting reference occurrences. */
export interface ReferenceManifest {
  /** Lowercase SHA-256 digest of the exact reference bytes. */
  readonly checksum: string;
  readonly mappings: readonly ReferenceManifestMapping[];
  /** Spatial identity evidence used by hierarchy/placement reports, never by authored code. */
  readonly spatialMappings?: readonly ReferenceManifestMapping[] | undefined;
}

export interface LoadReferenceRequest {
  readonly bytes: Uint8Array;
  readonly manifest: ReferenceManifest;
}

/** Source-neutral evidence returned by the public Reference Harness seam. */
export interface LoadedReference {
  readonly targets: readonly ReconstructionTarget[];
  readonly scene: ReferenceScene;
  readonly repetitions?: readonly ReferenceRepetitionObservation[] | undefined;
}

/** Harness-owned source inspection for preparing manifests and audit reports. */
export interface ReferenceInspectionProduct {
  readonly referenceGlobalId: string;
  readonly entityType: string;
  readonly name?: string | undefined;
  readonly material?: string | undefined;
  readonly parentReferenceGlobalId?: string | undefined;
  readonly representationItemTypes: readonly string[];
  readonly worldFrame?: ObservedFrame | undefined;
}

export interface ReferenceInspection {
  readonly checksum: string;
  readonly schema: string;
  readonly millimetresPerFileUnit: number;
  readonly entityCounts: Readonly<Record<string, number>>;
  readonly products: readonly ReferenceInspectionProduct[];
}

export type ReferenceHarnessResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ReferenceHarnessError };

/** Load selected reference occurrences without exposing representation-specific entities. */
export async function loadReference(
  request: LoadReferenceRequest
): Promise<ReferenceHarnessResult<LoadedReference>> {
  try {
    const actualChecksum = await sha256(request.bytes);
    if (actualChecksum !== request.manifest.checksum.toLowerCase()) {
      return {
        ok: false,
        error: referenceHarnessError(
          'CHECKSUM_MISMATCH',
          'Reference bytes do not match the manifest checksum',
          { expected: request.manifest.checksum.toLowerCase(), actual: actualChecksum }
        ),
      };
    }

    return await decodeIfcReference(request.bytes, request.manifest.mappings, [
      tessellatedRepresentationDecoder,
      parametricRepresentationDecoder,
      analyticBrepRepresentationDecoder,
    ]);
  } catch (cause) {
    return {
      ok: false,
      error: referenceHarnessError(
        'UNSUPPORTED_REPRESENTATION',
        'The Reference Harness could not load the supplied reference',
        { cause: errorMessage(cause) }
      ),
    };
  }
}

/** Inspect source identity and structure without making it authored-model input. */
export async function inspectReference(
  bytes: Uint8Array
): Promise<ReferenceHarnessResult<ReferenceInspection>> {
  try {
    const [checksum, inspected] = await Promise.all([sha256(bytes), inspectIfcReference(bytes)]);
    if (!inspected.ok) return inspected;
    return {
      ok: true,
      value: {
        checksum,
        schema: inspected.value.schema,
        millimetresPerFileUnit: inspected.value.millimetresPerFileUnit,
        entityCounts: inspected.value.entityCounts,
        products: inspected.value.products,
      },
    };
  } catch (cause) {
    return {
      ok: false,
      error: referenceHarnessError(
        'UNSUPPORTED_REPRESENTATION',
        'The Reference Harness could not inspect the supplied reference',
        { cause: errorMessage(cause) }
      ),
    };
  }
}

interface CryptoLike {
  readonly subtle: {
    digest(algorithm: string, data: Uint8Array): PromiseLike<ArrayBuffer>;
  };
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const crypto = (globalThis as { readonly crypto?: CryptoLike }).crypto;
  if (crypto === undefined) {
    throw new Error('SHA-256 is unavailable in this runtime');
  }
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
