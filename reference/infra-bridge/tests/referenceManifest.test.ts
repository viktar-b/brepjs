import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { ReferenceManifest } from '@brepjs/infra-bridge-reference';

describe('checksummed Reference Manifest', () => {
  it('maps exactly 47 unique semantic product keys without absolute source paths', async () => {
    const contents = await readFile(new URL('../referenceManifest.json', import.meta.url), 'utf8');
    const manifest = JSON.parse(contents) as ReferenceManifest;

    expect(manifest.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.mappings).toHaveLength(47);
    expect(manifest.spatialMappings).toHaveLength(21);
    expect(new Set(manifest.mappings.map(({ semanticKey }) => semanticKey))).toHaveLength(47);
    expect(
      new Set(manifest.mappings.map(({ referenceGlobalId }) => referenceGlobalId))
    ).toHaveLength(47);
    expect(
      manifest.mappings.every(({ semanticKey }) => semanticKey.startsWith('infra-bridge/'))
    ).toBe(true);
    expect(contents).not.toMatch(/(?:\/tmp\/|[A-Za-z]:\\|Infra-Bridge\.ifc)/);
  });
});
