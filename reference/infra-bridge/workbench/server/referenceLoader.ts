import { readFile } from 'node:fs/promises';
import {
  loadReference,
  type LoadedReference,
  type ReferenceHarnessResult,
  type ReferenceManifest,
  type ReferenceSceneNode,
} from '../../src/index.js';
import type { ReferenceOccurrenceNode } from '../../node/compareEvaluatedOccurrence.js';
import type { BackendResult, ReferenceSnapshot } from './workbenchRuntime.js';

export interface ReferenceLoaderConfig {
  readonly ifcPath: string;
  readonly manifest: ReferenceManifest;
}

export interface ReferenceLoaderDependencies {
  readonly readBytes: (path: string) => Promise<Uint8Array>;
  readonly decode: (
    bytes: Uint8Array,
    manifest: ReferenceManifest
  ) => Promise<ReferenceHarnessResult<LoadedReference>>;
}

const defaultDependencies: ReferenceLoaderDependencies = {
  async readBytes(path) {
    return readFile(path);
  },
  async decode(bytes, manifest) {
    return loadReference({ bytes, manifest });
  },
};

/** Read, checksum, decode, and exact-key index the configured IFC4X3 Reference. */
export async function loadReferenceSnapshot(
  config: ReferenceLoaderConfig,
  dependencies: ReferenceLoaderDependencies = defaultDependencies
): Promise<BackendResult<ReferenceSnapshot>> {
  let bytes: Uint8Array;
  try {
    bytes = await dependencies.readBytes(config.ifcPath);
  } catch (cause) {
    const causeCode = errorCode(cause);
    const missing = causeCode === 'ENOENT';
    return {
      ok: false,
      error: {
        stage: 'reference-file',
        code: missing ? 'REFERENCE_FILE_NOT_FOUND' : 'REFERENCE_FILE_UNREADABLE',
        message: missing
          ? 'The configured IFC4X3 Reference file does not exist'
          : 'The configured IFC4X3 Reference file could not be read',
        context: { path: config.ifcPath, ...(causeCode === null ? {} : { causeCode }) },
        retryable: true,
        action: 'Correct the --ifc path or file permissions, then retry the Reference load',
      },
    };
  }

  let decoded: ReferenceHarnessResult<LoadedReference>;
  try {
    decoded = await dependencies.decode(bytes, config.manifest);
  } catch (cause) {
    return {
      ok: false,
      error: {
        stage: 'reference-decode',
        code: 'REFERENCE_DECODE_FAILED',
        message:
          cause instanceof Error ? cause.message : 'The IFC4X3 Reference could not be decoded',
        context: { path: config.ifcPath },
        retryable: true,
        action: 'Verify web-ifc initialization and inspect the configured IFC4X3 file, then retry',
      },
    };
  }
  if (!decoded.ok) {
    const checksum = decoded.error.code === 'CHECKSUM_MISMATCH';
    return {
      ok: false,
      error: {
        stage: checksum ? 'checksum' : 'reference-decode',
        code: decoded.error.code,
        message: decoded.error.message,
        context: { path: config.ifcPath, ...decoded.error.context },
        retryable: true,
        action: checksum
          ? 'Select the IFC file whose SHA-256 matches referenceManifest.json'
          : 'Inspect the mapped IFC4X3 product and repair the reported Reference evidence',
      },
    };
  }

  const referenceScenes = new Map<string, ReferenceOccurrenceNode>();
  for (const node of flattenScene(decoded.value.scene.roots)) {
    if (node.kind === 'product' && node.targetKey !== undefined) {
      referenceScenes.set(node.targetKey, {
        targetKey: node.targetKey,
        localFrame: node.localFrame,
        worldFrame: node.worldFrame,
      });
    }
  }
  return {
    ok: true,
    value: {
      targets: new Map(decoded.value.targets.map((target) => [target.semanticKey, target])),
      referenceScenes,
    },
  };
}

function flattenScene(nodes: readonly ReferenceSceneNode[]): readonly ReferenceSceneNode[] {
  return nodes.flatMap((node) =>
    node.kind === 'spatial' ? [node, ...flattenScene(node.children)] : [node]
  );
}

function errorCode(cause: unknown): string | null {
  if (typeof cause !== 'object' || cause === null || !('code' in cause)) return null;
  return typeof cause.code === 'string' ? cause.code : null;
}
