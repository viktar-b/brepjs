// @vitest-environment jsdom

import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkbenchProduct } from '../shared/protocol.js';
import { ProductRail } from '../src/ProductRail.js';

const FIRST = 'infra-bridge/rail-site-01/rail-bridge-01/substructure/pier-01/footing';
const SECOND = 'infra-bridge/rail-site-02/rail-bridge-02/substructure/pier-01/footing';
const DECK = 'infra-bridge/road-site/road-river-bridge/deck/bridge-deck';

describe('responsive Semantic Key selector', () => {
  let host: HTMLDivElement;
  let root: Root;
  let mounted: boolean;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    mounted = true;
    act(() => {
      root.render(createElement(Harness));
    });
  });

  afterEach(() => {
    if (mounted) {
      act(() => {
        root.unmount();
      });
    }
    host.remove();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('identifies repeated products by their exact path in compact options', () => {
    const options = select().options;

    expect(options).toHaveLength(3);
    expect(options[0]?.textContent).toContain(FIRST);
    expect(options[1]?.textContent).toContain(SECOND);
    expect(options[0]?.textContent).not.toBe(options[1]?.textContent);
  });

  it('applies the Semantic Key search to the compact selector', () => {
    act(() => {
      setInputValue(search(), 'rail-site-02');
    });

    expect(select().options).toHaveLength(2);
    expect(select().options[0]?.disabled).toBe(true);
    expect(select().options[0]?.textContent).toContain('1 matching occurrence');
    expect(select().options[1]?.value).toBe(SECOND);
    expect(select().options[1]?.textContent).toContain('Rail bridge 02');

    act(() => {
      setInputValue(search(), 'not-in-manifest');
    });
    expect(select().options).toHaveLength(1);
    expect(select().options[0]?.disabled).toBe(true);
    expect(select().options[0]?.textContent).toContain('No matching occurrences');
  });

  it('does not attribute copy feedback to a newly selected Semantic Key', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    await act(async () => {
      copyButton().click();
      await Promise.resolve();
    });
    expect(copyButton().title).toBe('Copied');

    act(() => {
      productButton(SECOND).click();
    });

    expect(copyButton().title).toBe('Copy full key');
    expect(vi.getTimerCount()).toBe(0);
    expect(writeText).toHaveBeenCalledWith(FIRST);
  });

  it('cancels pending copy feedback when the product rail unmounts', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('navigator', {
      clipboard: { writeText: () => Promise.resolve() },
    });

    await act(async () => {
      copyButton().click();
      await Promise.resolve();
    });
    expect(vi.getTimerCount()).toBe(1);

    act(() => {
      root.unmount();
    });
    mounted = false;

    expect(vi.getTimerCount()).toBe(0);
  });

  function search(): HTMLInputElement {
    const input = host.querySelector<HTMLInputElement>('[aria-label="Search Semantic Keys"]');
    if (input === null) throw new Error('search input not found');
    return input;
  }

  function select(): HTMLSelectElement {
    const control = host.querySelector<HTMLSelectElement>('[aria-label="Select Semantic Key"]');
    if (control === null) throw new Error('compact select not found');
    return control;
  }

  function copyButton(): HTMLButtonElement {
    const button = host.querySelector<HTMLButtonElement>(
      '[aria-label="Copy selected Semantic Key"]'
    );
    if (button === null) throw new Error('copy button not found');
    return button;
  }

  function productButton(semanticKey: string): HTMLButtonElement {
    const button = host.querySelector<HTMLButtonElement>(`[data-semantic-key="${semanticKey}"]`);
    if (button === null) throw new Error(`product button not found: ${semanticKey}`);
    return button;
  }
});

function Harness() {
  const [query, setQuery] = useState('');
  const [selectedKey, setSelectedKey] = useState(FIRST);
  return createElement(ProductRail, {
    products: PRODUCTS,
    selectedKey,
    query,
    onQueryChange: setQuery,
    onSelect: setSelectedKey,
  });
}

const PRODUCTS: readonly WorkbenchProduct[] = [
  {
    semanticKey: FIRST,
    group: 'Rail bridge 01',
    label: 'Footing',
    detail: 'Substructure / Pier 01 / Footing',
  },
  {
    semanticKey: SECOND,
    group: 'Rail bridge 02',
    label: 'Footing',
    detail: 'Substructure / Pier 01 / Footing',
  },
  {
    semanticKey: DECK,
    group: 'Road river bridge',
    label: 'Bridge Deck',
    detail: 'Road River Bridge / Deck / Bridge Deck',
  },
];

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.bind(
    input
  );
  setter?.(value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
