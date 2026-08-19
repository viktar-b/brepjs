import type { ReconstructionTarget, ReferenceScene } from './contracts.js';
import type { ReferenceHarnessError } from './errors.js';
import { referenceHarnessError } from './errors.js';
import { decodeIfcReference } from './ifcReferenceAdapter.js';
import { parametricRepresentationDecoder } from './parametricIfcAdapter.js';
import { tessellatedRepresentationDecoder } from './tessellatedIfcAdapter.js';

export interface ReferenceManifestMapping {
  readonly semanticKey: string;
  readonly referenceGlobalId: string;
}

/** Checksummed, authored identity mapping for selecting reference occurrences. */
export interface ReferenceManifest {
  /** Lowercase SHA-256 digest of the exact reference bytes. */
  readonly checksum: string;
  readonly mappings: readonly ReferenceManifestMapping[];
}

export interface LoadReferenceRequest {
  readonly bytes: Uint8Array;
  readonly manifest: ReferenceManifest;
}

/** Source-neutral evidence returned by the public Reference Harness seam. */
export interface LoadedReference {
  readonly targets: readonly ReconstructionTarget[];
  readonly scene: ReferenceScene;
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
