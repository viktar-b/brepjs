import { describe, expect, it } from 'vitest';
import type { LoadedReference, ReferenceManifest } from '../../src/index.js';
import { loadReferenceSnapshot } from '../server/referenceLoader.js';

const KEY = 'infra-bridge/synthetic/member';
const FRAME = { origin: [0, 0, 0], xAxis: [1, 0, 0], zAxis: [0, 0, 1] } as const;
const MANIFEST: ReferenceManifest = {
  checksum: 'expected-sha',
  mappings: [{ semanticKey: KEY, referenceGlobalId: 'private-source-id' }],
};

describe('configured Reference loader', () => {
  it('maps file access failures to an actionable Reference-file error', async () => {
    const result = await loadReferenceSnapshot(
      { ifcPath: '/missing/Infra-Bridge.ifc', manifest: MANIFEST },
      {
        readBytes() {
          return Promise.reject(Object.assign(new Error('not found'), { code: 'ENOENT' }));
        },
        decode() {
          return Promise.reject(new Error('decode must not run'));
        },
      }
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        stage: 'reference-file',
        code: 'REFERENCE_FILE_NOT_FOUND',
        context: { path: '/missing/Infra-Bridge.ifc' },
        retryable: true,
      },
    });
  });

  it('preserves checksum and decoder error evidence', async () => {
    const result = await loadReferenceSnapshot(
      { ifcPath: '/reference/Infra-Bridge.ifc', manifest: MANIFEST },
      {
        readBytes() {
          return Promise.resolve(new Uint8Array([1, 2, 3]));
        },
        decode() {
          return Promise.resolve({
            ok: false,
            error: {
              code: 'CHECKSUM_MISMATCH',
              message: 'Reference checksum does not match',
              context: { expected: 'expected-sha', actual: 'actual-sha' },
            },
          });
        },
      }
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        stage: 'checksum',
        code: 'CHECKSUM_MISMATCH',
        context: { expected: 'expected-sha', actual: 'actual-sha' },
      },
    });
    if (result.ok) throw new Error('expected a checksum failure');
    expect(result.error.action).toContain('referenceManifest.json');
  });

  it('maps a decoder rejection to an actionable Reference-decode error', async () => {
    const result = await loadReferenceSnapshot(
      { ifcPath: '/reference/Infra-Bridge.ifc', manifest: MANIFEST },
      {
        readBytes() {
          return Promise.resolve(new Uint8Array([1, 2, 3]));
        },
        decode() {
          return Promise.reject(new Error('web-ifc could not initialize'));
        },
      }
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        stage: 'reference-decode',
        code: 'REFERENCE_DECODE_FAILED',
        message: 'web-ifc could not initialize',
        retryable: true,
      },
    });
  });

  it('indexes product placements recursively by exact target Semantic Key', async () => {
    const loaded: LoadedReference = {
      targets: [
        {
          semanticKey: KEY,
          comparisonSurface: {
            unit: 'millimetre',
            vertices: [
              [0, 0, 0],
              [1, 0, 0],
              [0, 1, 0],
            ],
            triangles: [[0, 1, 2]],
            closed: false,
          },
        },
      ],
      scene: {
        unit: 'millimetre',
        roots: [
          {
            kind: 'spatial',
            referenceKey: 'root',
            localFrame: FRAME,
            worldFrame: FRAME,
            children: [
              {
                kind: 'product',
                referenceKey: 'product',
                targetKey: KEY,
                localFrame: FRAME,
                worldFrame: FRAME,
              },
            ],
          },
        ],
      },
      repetitions: [],
    };
    const result = await loadReferenceSnapshot(
      { ifcPath: '/reference/Infra-Bridge.ifc', manifest: MANIFEST },
      {
        readBytes() {
          return Promise.resolve(new Uint8Array([1]));
        },
        decode() {
          return Promise.resolve({ ok: true, value: loaded });
        },
      }
    );

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error('expected a loaded Reference');
    expect(result.value.targets.get(KEY)?.semanticKey).toBe(KEY);
    expect(result.value.referenceScenes.get(KEY)?.targetKey).toBe(KEY);
  });
});
