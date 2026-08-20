import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { ReferenceManifest } from '../../src/index.js';
import { evaluateAuthoredSnapshot } from '../server/evaluateAuthored.js';

describe('complete authored infra-bridge Model evaluation', () => {
  it('copies every manifest product Occurrence into a server-owned snapshot', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('../../referenceManifest.json', import.meta.url), 'utf8')
    ) as ReferenceManifest;

    const result = await evaluateAuthoredSnapshot();

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error(result.error.message);
    for (const { semanticKey } of manifest.mappings) {
      expect(result.value.resolvedNodes.has(semanticKey), semanticKey).toBe(true);
      expect(result.value.evaluatedNodes.get(semanticKey)?.mesh.ok, semanticKey).toBe(true);
    }
  }, 30_000);
});
