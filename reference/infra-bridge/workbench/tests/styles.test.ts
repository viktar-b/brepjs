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

  it('defines a complete light color scheme for the shell and viewport', async () => {
    const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    const lightTheme = styles.match(/:root\[data-theme=['"]light['"]\]\s*\{(?<rules>[^}]*)\}/u);

    expect(lightTheme?.groups?.['rules']).toMatch(/color-scheme:\s*light/u);
    expect(lightTheme?.groups?.['rules']).toMatch(/--wb-bg:\s*#[0-9a-f]{6}/u);
    expect(lightTheme?.groups?.['rules']).toMatch(/--wb-panel:\s*#[0-9a-f]{6}/u);
    expect(styles).toMatch(
      /:root\[data-theme=['"]light['"]\][\s\S]*?\.viewport-stage\s*\{[\s\S]*?background-color:/u
    );
  });

  it('keeps selected comparison modes and viewport badges legible in light mode', async () => {
    const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    const selectedMode = styles.match(
      /:root\[data-theme=['"]light['"]\] \.mode-switcher \.control-button\[aria-pressed=['"]true['"]\]\s*\{(?<rules>[^}]*)\}/u
    );
    const selectedControl = styles.match(
      /:root\[data-theme=['"]light['"]\] \.control-button\[aria-pressed=['"]true['"]\]\s*\{(?<rules>[^}]*)\}/u
    );
    const badges = styles.match(
      /:root\[data-theme=['"]light['"]\] \.coordinate-badge,[\s\S]*?\.units-badge\s*\{(?<rules>[^}]*)\}/u
    );

    expect(selectedMode?.groups?.['rules']).toMatch(/background:\s*var\(--wb-accent\)/u);
    expect(selectedMode?.groups?.['rules']).toMatch(/color:\s*#ffffff/u);
    expect(selectedControl?.groups?.['rules']).toMatch(/background:\s*var\(--wb-accent-soft\)/u);
    expect(badges?.groups?.['rules']).toMatch(/background:\s*rgb\(255 255 255/u);
    expect(badges?.groups?.['rules']).toMatch(/color:\s*var\(--wb-text-soft\)/u);
  });

  it('constrains the desktop evidence ledger and releases it into the mobile page flow', async () => {
    const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    const desktopScroller = styles.match(/\.evidence-scroll\s*\{(?<rules>[^}]*)\}/u);
    const mobile = styles.match(/@media \(max-width: 799px\)\s*\{(?<rules>[\s\S]*?)\n\}/u);

    expect(desktopScroller?.groups?.['rules']).toMatch(/height:\s*100%/u);
    expect(mobile?.groups?.['rules']).toMatch(
      /\.evidence-scroll\s*\{[^}]*height:\s*auto[^}]*overflow:\s*visible/u
    );
  });
});
