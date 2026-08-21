import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { ReferenceManifest } from '../../src/index.js';
import { componentSourceDescriptors } from '../server/componentSourceLoader.js';
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
      expect(result.value.sourceDescriptors.get(semanticKey), semanticKey).toMatchObject({
        semanticKey,
        definitionName: expect.any(String),
      });
    }
    expect(
      result.value.sourceDescriptors.get(
        'infra-bridge/road-site/road-river-bridge/deck/bridge-deck'
      )
    ).toEqual({
      semanticKey: 'infra-bridge/road-site/road-river-bridge/deck/bridge-deck',
      definitionName: 'BridgeDeck',
    });
    const allowedDefinitions = new Set(
      componentSourceDescriptors().map(({ definitionName }) => definitionName)
    );
    expect(
      [...result.value.sourceDescriptors.values()]
        .filter(({ semanticKey }) =>
          manifest.mappings.some((mapping) => mapping.semanticKey === semanticKey)
        )
        .every(({ definitionName }) => allowedDefinitions.has(definitionName))
    ).toBe(true);
  }, 30_000);
});
