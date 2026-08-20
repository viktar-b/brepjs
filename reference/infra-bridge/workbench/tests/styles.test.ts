import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('workbench interaction styles', () => {
  it('keeps the compact Semantic Key selector focus indicator visible', async () => {
    const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    const compactSelect = styles.match(/\.compact-product-select select\s*\{(?<rules>[^}]*)\}/u);

    expect(compactSelect?.groups?.['rules']).toBeDefined();
    expect(compactSelect?.groups?.['rules']).not.toMatch(/\boutline\s*:\s*(?:0|none)\b/u);
    expect(styles).toMatch(/select:focus-visible,[\s\S]*?outline:\s*2px solid var\(--wb-accent\)/u);
  });

  it('keeps the Semantic Key search focus indicator visible', async () => {
    const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    const searchInput = styles.match(/\.search-field input\s*\{(?<rules>[^}]*)\}/u);

    expect(searchInput?.groups?.['rules']).toBeDefined();
    expect(searchInput?.groups?.['rules']).not.toMatch(/\boutline\s*:\s*(?:0|none)\b/u);
    expect(styles).toMatch(/input:focus-visible,[\s\S]*?outline:\s*2px solid var\(--wb-accent\)/u);
  });
});
