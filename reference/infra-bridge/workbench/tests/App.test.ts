// @vitest-environment jsdom

import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ComponentSourceDiagnostic,
  ComparisonDiagnostic,
  OverallDiagnostic,
  WorkbenchCatalog,
  WorkbenchResult,
} from '../shared/protocol.js';
import { App } from '../src/App.js';
import { WORKBENCH_THEME_STORAGE_KEY } from '../src/theme.js';

vi.mock('brepjs-viewer', () => ({
  ViewerCanvas: ({
    children,
    data,
    view,
    projection,
    fitSignal,
    colorScheme,
  }: {
    readonly children?: ReactNode;
    readonly data: { readonly position: Float32Array };
    readonly view?: string;
    readonly projection?: string;
    readonly fitSignal?: number;
    readonly colorScheme?: string;
  }) =>
    createElement(
      'div',
      {
        'data-testid': 'shared-r3f-canvas',
        'data-framing-maximum': Math.max(...data.position).toString(),
        'data-view': view,
        'data-projection': projection,
        'data-fit-signal': fitSignal?.toString(),
        'data-color-scheme': colorScheme,
      },
      children
    ),
  Renderer: ({
    data,
    viewMode,
    clippingPlanes,
  }: {
    readonly data: { readonly color?: string };
    readonly viewMode?: string;
    readonly clippingPlanes?: readonly unknown[];
  }) =>
    createElement('span', {
      'data-layer-color': data.color,
      'data-view-mode': viewMode,
      'data-clipping': JSON.stringify(clippingPlanes?.[0] ?? null),
    }),
  EdgeRenderer: ({ clippingPlanes }: { readonly clippingPlanes?: readonly unknown[] }) =>
    createElement('span', {
      'data-testid': 'mesh-edges',
      'data-clipping': JSON.stringify(clippingPlanes?.[0] ?? null),
    }),
  meshBounds: () => ({ min: [0, 0, 0], max: [10, 20, 30] }),
  sectionPlane: (axis: string, position: number, flip: boolean) => ({ axis, position, flip }),
}));

vi.mock('@react-three/drei', () => ({
  Grid: () => createElement('span', { 'data-testid': 'scale-aware-grid' }),
}));

const FIRST = 'infra-bridge/rail-site-01/rail-bridge-01/superstructure/arch-segment-01';
const SECOND = 'infra-bridge/road-site/road-river-bridge/deck/bridge-deck';

describe('Survey Bench application', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    window.localStorage.clear();
    delete document.documentElement.dataset['theme'];
    vi.stubGlobal('matchMedia', matchMediaStub(false));
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
    vi.unstubAllGlobals();
  });

  it('opens the two complete models first and switches to Manifest products from a fixed rail', async () => {
    const requests: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => {
        const url = requestUrl(input);
        requests.push(url);
        const value =
          url === '/api/workbench'
            ? catalog()
            : url === '/api/workbench/overall'
              ? overallDiagnostic()
              : diagnostic();
        return Promise.resolve(jsonResponse(success(value)));
      })
    );

    act(() => {
      root.render(createElement(App));
    });
    await waitFor(() => host.textContent.includes('Reference model'));

    expect(requests.slice(0, 2)).toEqual(['/api/workbench', '/api/workbench/overall']);
    expect(button('Overall comparison')?.getAttribute('aria-pressed')).toBe('true');
    expect(button('Manifest products')?.getAttribute('aria-pressed')).toBe('false');
    expect(button('Component source')?.getAttribute('aria-pressed')).toBe('false');
    expect(host.querySelectorAll('.mode-rail__button')).toHaveLength(3);
    expect(labelledControl('Search Semantic Keys')).toBeNull();
    expect(host.textContent).toContain('Candidate model');
    expect(host.querySelectorAll('[data-testid="shared-r3f-canvas"]')).toHaveLength(2);

    act(() => button('Front')?.click());
    expect(
      [...host.querySelectorAll('[data-testid="shared-r3f-canvas"]')].map((canvas) =>
        canvas.getAttribute('data-view')
      )
    ).toEqual(['front', 'front']);

    act(() => button('Fit overall models')?.click());
    expect(
      [...host.querySelectorAll('[data-testid="shared-r3f-canvas"]')].map((canvas) =>
        canvas.getAttribute('data-fit-signal')
      )
    ).toEqual(['1', '1']);

    act(() => button('Manifest products')?.click());
    await waitFor(() => labelledControl('Search Semantic Keys') !== null);

    expect(requests[2]).toContain('/api/workbench/comparison?semanticKey=');
    expect(button('Overall comparison')?.getAttribute('aria-pressed')).toBe('false');
    expect(button('Manifest products')?.getAttribute('aria-pressed')).toBe('true');
    expect(host.textContent).toContain('Fidelity evidence');
  });

  it('inspects the selected Family TSX beside its canonical Candidate on one bright canvas', async () => {
    const requests: string[] = [];
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => {
        const url = requestUrl(input);
        requests.push(url);
        if (url === '/api/workbench') return Promise.resolve(jsonResponse(success(catalog())));
        if (url === '/api/workbench/overall') {
          return Promise.resolve(jsonResponse(success(overallDiagnostic())));
        }
        if (url.startsWith('/api/workbench/component-source')) {
          const key =
            new URL(url, 'http://workbench.local').searchParams.get('semanticKey') ?? FIRST;
          return Promise.resolve(jsonResponse(success(componentSourceDiagnostic(key))));
        }
        return Promise.resolve(jsonResponse(success(diagnostic())));
      })
    );

    act(() => {
      root.render(createElement(App));
    });
    await waitFor(() => button('Component source') !== null);
    act(() => button('Component source')?.click());
    await waitFor(() => host.querySelector('.component-source-code .shiki') !== null);

    expect(requests.at(-1)).toContain('/api/workbench/component-source?semanticKey=');
    expect(button('Component source')?.getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelectorAll('.mode-rail__button')).toHaveLength(3);
    expect(labelledControl('Search Semantic Keys')).not.toBeNull();
    expect(host.textContent).toContain('Component source');
    expect(host.textContent).toContain('ArchSegment');
    expect(host.textContent).toContain('archSegment.tsx');
    expect(host.textContent).toContain('READ ONLY · edit in IDE');
    expect(host.querySelector('.component-source-code pre > code > .line')).not.toBeNull();
    expect(host.querySelector('.component-source-code [data-line="2"]')).not.toBeNull();
    expect(host.querySelectorAll('[data-testid="shared-r3f-canvas"]')).toHaveLength(1);
    expect(host.querySelector('[data-layer-color="#f0ad55"]')).not.toBeNull();
    expect(host.querySelector('[data-color-scheme="dark"]')).not.toBeNull();
    expect(host.textContent).toContain('Canonical component-local');
    expect(host.textContent).not.toContain('Fidelity evidence');
    expect(button('Candidate x-ray')?.getAttribute('aria-pressed')).toBe('false');
    expect(button('Candidate edges')?.getAttribute('aria-pressed')).toBe('true');
    expect(button('Fit source geometry')?.hasAttribute('aria-pressed')).toBe(false);

    await act(async () => {
      button('Copy Family source')?.click();
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith(
      'export const ArchSegment = family();\n\n// Candidate geometry'
    );
    expect(button('Copy Family source')?.textContent).toContain('Copied');

    act(() => host.querySelector<HTMLButtonElement>(`[data-semantic-key="${SECOND}"]`)?.click());
    await waitFor(() => host.textContent.includes('bridgeDeck.tsx'));
    expect(button('Copy Family source')?.textContent).toContain('Copy source');
    expect(
      host.querySelector(`[data-semantic-key="${SECOND}"]`)?.getAttribute('aria-current')
    ).toBe('true');

    act(() => button('Manifest products')?.click());
    await waitFor(() => host.textContent.includes('Fidelity evidence'));
    expect(
      host.querySelector(`[data-semantic-key="${SECOND}"]`)?.getAttribute('aria-current')
    ).toBe('true');
    act(() => button('Component source')?.click());
    await waitFor(() => host.textContent.includes('bridgeDeck.tsx'));
    expect(
      host.querySelector(`[data-semantic-key="${SECOND}"]`)?.getAttribute('aria-current')
    ).toBe('true');
  });

  it('holds source, selection, scroll, and useful view state through a same-key refresh and mode switch', async () => {
    const pendingRefresh = deferred<Response>();
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url = requestUrl(input);
        if (url === '/api/workbench') return Promise.resolve(jsonResponse(success(catalog())));
        if (url === '/api/workbench/overall') {
          return Promise.resolve(jsonResponse(success(overallDiagnostic())));
        }
        if (url.startsWith('/api/workbench/component-source')) {
          if (init?.method === 'POST') return pendingRefresh.promise;
          return Promise.resolve(jsonResponse(success(componentSourceDiagnostic())));
        }
        return Promise.resolve(jsonResponse(success(diagnostic())));
      })
    );

    act(() => {
      root.render(createElement(App));
    });
    await waitFor(() => button('Component source') !== null);
    act(() => button('Component source')?.click());
    await waitFor(() => host.querySelector('.component-source-code') !== null);
    const codeScroller = host.querySelector<HTMLDivElement>('.component-source-code');
    const originalCanvas = host.querySelector('[data-testid="shared-r3f-canvas"]');
    if (codeScroller === null || originalCanvas === null)
      throw new Error('source bench did not mount');
    codeScroller.scrollTop = 120;
    act(() => {
      codeScroller.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    act(() => button('Top')?.click());
    act(() => button('Candidate x-ray')?.click());

    act(() => button('Recompute')?.click());
    expect(host.textContent).toContain('Previous successful source and geometry held');
    expect(host.querySelector('[data-testid="shared-r3f-canvas"]')).toBe(originalCanvas);
    expect(button('Candidate x-ray')?.getAttribute('aria-pressed')).toBe('true');

    pendingRefresh.resolve(
      jsonResponse(success({ ...componentSourceDiagnostic(), revision: 8, durationMs: 101 }))
    );
    await waitFor(() => host.textContent.includes('Revision 8'));
    expect(host.querySelector<HTMLDivElement>('.component-source-code')?.scrollTop).toBe(120);
    expect(host.querySelector('[data-testid="shared-r3f-canvas"]')).toBe(originalCanvas);

    act(() => button('Manifest products')?.click());
    await waitFor(() => host.textContent.includes('Fidelity evidence'));
    act(() => button('Component source')?.click());
    await waitFor(() => host.querySelector('.component-source-code') !== null);
    expect(host.querySelector('[data-testid="shared-r3f-canvas"]')?.getAttribute('data-view')).toBe(
      'top'
    );
    expect(host.querySelector<HTMLDivElement>('.component-source-code')?.scrollTop).toBe(120);
  });

  it('shows structured Component Source failures and retries source plus geometry', async () => {
    const requests: { readonly url: string; readonly method: string }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url = requestUrl(input);
        const method = init?.method ?? 'GET';
        requests.push({ url, method });
        if (url === '/api/workbench') return Promise.resolve(jsonResponse(success(catalog())));
        if (url === '/api/workbench/overall') {
          return Promise.resolve(jsonResponse(success(overallDiagnostic())));
        }
        if (url.startsWith('/api/workbench/component-source') && method === 'POST') {
          return Promise.resolve(
            jsonResponse(success({ ...componentSourceDiagnostic(), revision: 8 }))
          );
        }
        if (url.startsWith('/api/workbench/component-source')) {
          return Promise.resolve(
            jsonResponse({
              ok: false,
              revision: 7,
              error: {
                stage: 'source-file',
                code: 'COMPONENT_SOURCE_READ_FAILED',
                message: 'The approved Family source could not be read.',
                context: {
                  semanticKey: FIRST,
                  path: 'examples/infra-bridge/src/families/archSegment.tsx',
                },
                retryable: true,
                action: 'Restore the approved TSX file, then retry.',
              },
            })
          );
        }
        return Promise.resolve(jsonResponse(success(diagnostic())));
      })
    );

    act(() => {
      root.render(createElement(App));
    });
    await waitFor(() => button('Component source') !== null);
    act(() => button('Component source')?.click());
    await waitFor(() => host.querySelector('.component-source-error') !== null);

    const alert = host.querySelector('.component-source-error');
    expect(alert?.textContent).toContain('source file');
    expect(alert?.textContent).toContain('COMPONENT_SOURCE_READ_FAILED');
    expect(alert?.textContent).toContain('The approved Family source could not be read.');
    expect(alert?.textContent).toContain('Restore the approved TSX file, then retry.');
    expect(alert?.textContent).toContain('semanticKey');
    expect(alert?.textContent).toContain('archSegment.tsx');

    act(() => button('Retry source and geometry')?.click());
    await waitFor(() => host.textContent.includes('Candidate source and geometry ready'));
    expect(requests.at(-1)?.method).toBe('POST');
    expect(host.querySelector('.component-source-error')).toBeNull();
    expect(host.querySelector('[data-testid="shared-r3f-canvas"]')).not.toBeNull();
  });

  it('keeps the complete models visible and exposes an actionable refresh failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url = requestUrl(input);
        if (url === '/api/workbench') return Promise.resolve(jsonResponse(success(catalog())));
        if (init?.method === 'POST') {
          return Promise.resolve(
            jsonResponse({
              ok: false,
              revision: 8,
              error: {
                stage: 'authored-evaluation',
                code: 'CANDIDATE_EVALUATION_FAILED',
                message: 'The complete authored Model did not evaluate.',
                context: { semanticKey: FIRST },
                retryable: true,
                action: 'Repair the Candidate Family, then recompute.',
              },
            })
          );
        }
        return Promise.resolve(jsonResponse(success(overallDiagnostic())));
      })
    );

    act(() => {
      root.render(createElement(App));
    });
    await waitFor(() => host.textContent.includes('Reference model'));
    act(() => button('Recompute')?.click());
    await waitFor(() => host.querySelector('.overall-error-banner') !== null);

    expect(host.querySelectorAll('[data-testid="shared-r3f-canvas"]')).toHaveLength(2);
    expect(host.querySelector('.overall-error-banner')?.textContent).toContain(
      'The complete authored Model did not evaluate.'
    );
    expect(host.querySelector('.overall-error-banner')?.textContent).toContain(
      'Repair the Candidate Family, then recompute.'
    );
    expect(host.querySelector('.overall-error-banner')?.textContent).toContain(
      'Authored evaluation'
    );
    expect(host.querySelector('.overall-error-banner')?.textContent).toContain('semanticKey');
    expect(host.querySelector('.overall-error-banner')?.textContent).toContain(FIRST);
    expect(button('Retry overall model')).not.toBeNull();
  });

  it('uses the saved theme ahead of the OS preference and persists a light-mode choice', async () => {
    window.localStorage.setItem(WORKBENCH_THEME_STORAGE_KEY, 'dark');
    vi.stubGlobal('matchMedia', matchMediaStub(true));
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) =>
        Promise.resolve(
          jsonResponse(
            requestUrl(input) === '/api/workbench'
              ? success(catalog())
              : success(overallDiagnostic())
          )
        )
      )
    );

    act(() => {
      root.render(createElement(App));
    });
    await waitFor(() => host.querySelector('[data-testid="shared-r3f-canvas"]') !== null);

    const lightMode = button('Light mode');
    expect(host.querySelector('.workbench-shell')?.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.dataset['theme']).toBe('dark');
    expect(lightMode?.getAttribute('aria-pressed')).toBe('false');

    act(() => lightMode?.click());

    expect(host.querySelector('.workbench-shell')?.getAttribute('data-theme')).toBe('light');
    expect(document.documentElement.dataset['theme']).toBe('light');
    expect(button('Light mode')?.getAttribute('aria-pressed')).toBe('true');
    expect(window.localStorage.getItem(WORKBENCH_THEME_STORAGE_KEY)).toBe('light');
    expect(host.querySelector('[data-layer-color="#1687a3"]')).not.toBeNull();
    expect(host.querySelector('[data-layer-color="#c16b1b"]')).not.toBeNull();
    expect(
      host.querySelector('[data-testid="shared-r3f-canvas"]')?.getAttribute('data-color-scheme')
    ).toBe('light');
  });

  it('starts in light mode when the OS prefers a light color scheme', () => {
    vi.stubGlobal('matchMedia', matchMediaStub(true));
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => undefined))
    );

    act(() => {
      root.render(createElement(App));
    });

    expect(host.querySelector('.workbench-shell')?.getAttribute('data-theme')).toBe('light');
    expect(button('Light mode')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('presents every diagnostic control and all Fidelity evidence around one shared canvas', async () => {
    const requests: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => {
        const url = requestUrl(input);
        requests.push(url);
        const value =
          url === '/api/workbench'
            ? catalog()
            : url === '/api/workbench/overall'
              ? overallDiagnostic()
              : diagnostic();
        return Promise.resolve(jsonResponse(success(value)));
      })
    );

    act(() => {
      root.render(createElement(App));
    });
    await openManifestProducts();
    await waitFor(() => host.querySelector('[data-testid="shared-r3f-canvas"]') !== null);

    expect(requests[0]).toBe('/api/workbench');
    expect(requests[1]).toBe('/api/workbench/overall');
    expect(requests[2]).toContain(`semanticKey=${encodeURIComponent(FIRST)}`);
    expect(host.querySelectorAll('[data-testid="shared-r3f-canvas"]')).toHaveLength(1);
    expect(labelledControl('Search Semantic Keys')).not.toBeNull();
    expect(button('Reference')?.hasAttribute('aria-pressed')).toBe(true);
    expect(button('Candidate')?.hasAttribute('aria-pressed')).toBe(true);
    expect(button('Overlay')?.getAttribute('aria-pressed')).toBe('true');
    expect(button('Reference visible')?.getAttribute('aria-pressed')).toBe('true');
    expect(button('Candidate visible')?.getAttribute('aria-pressed')).toBe('true');
    expect(button('Reference x-ray')?.getAttribute('aria-pressed')).toBe('true');
    expect(button('Candidate edges')?.getAttribute('aria-pressed')).toBe('true');
    expect(button('Section plane')?.getAttribute('aria-pressed')).toBe('false');
    expect(button('Iso')?.getAttribute('aria-pressed')).toBe('true');
    expect(button('Front')).not.toBeNull();
    expect(button('Top')).not.toBeNull();
    expect(button('Right')).not.toBeNull();
    expect(button('Orthographic')?.getAttribute('aria-pressed')).toBe('false');
    expect(button('Fit')?.hasAttribute('aria-pressed')).toBe(false);
    expect(button('Grid')?.getAttribute('aria-pressed')).toBe('true');
    expect(button('Recompute')).not.toBeNull();

    for (const evidence of [
      'Control point',
      'X-axis angle',
      'Z-axis angle',
      'Envelope maximum',
      'Surface maximum',
      'Surface mean',
      'Surface P95',
      'Normal mean',
      'Normal minimum',
      'Volume error',
      'Closed-solid IoU',
    ]) {
      expect(host.textContent).toContain(evidence);
    }
    expect(host.textContent).toContain('Canonical component-local');
    expect(host.textContent).toContain('Revision 7');
    expect(host.querySelector('.reference-status')?.textContent).toContain('checksum verified');
    const canvas = host.querySelector('[data-testid="shared-r3f-canvas"]');
    expect(canvas?.getAttribute('data-view')).toBe('iso');
    expect(canvas?.getAttribute('data-projection')).toBe('perspective');
    expect(host.querySelectorAll('[data-testid="mesh-edges"]')).toHaveLength(1);
    expect(host.querySelector('[data-layer-color="#61d7f4"]')?.getAttribute('data-view-mode')).toBe(
      'xray'
    );

    act(() => button('Reference x-ray')?.click());
    expect(host.querySelector('[data-layer-color="#61d7f4"]')?.getAttribute('data-view-mode')).toBe(
      'solid'
    );
    act(() => button('Reference x-ray')?.click());
    act(() => button('Reference edges')?.click());
    expect(host.querySelectorAll('[data-testid="mesh-edges"]')).toHaveLength(2);
    act(() => button('Reference edges')?.click());
    act(() => button('Top')?.click());
    expect(canvas?.getAttribute('data-view')).toBe('top');
    const fitBefore = Number(canvas?.getAttribute('data-fit-signal'));
    act(() => button('Fit')?.click());
    expect(Number(canvas?.getAttribute('data-fit-signal'))).toBeGreaterThan(fitBefore);
    act(() => button('Orthographic')?.click());
    expect(canvas?.getAttribute('data-projection')).toBe('orthographic');

    const stage = host.querySelector('.viewport-stage');
    const controls = host.querySelector<HTMLDetailsElement>('.viewport-controls');
    const evidence = host.querySelector<HTMLDetailsElement>('.evidence-pane');
    if (stage === null || controls === null || evidence === null) {
      throw new Error('responsive workbench regions are missing');
    }
    expect(stage.compareDocumentPosition(controls) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    controls.open = false;
    evidence.open = false;
    expect(host.querySelector('[data-testid="shared-r3f-canvas"]')).not.toBeNull();
    controls.open = true;
    evidence.open = true;

    act(() => button('Reference')?.click());
    expect(host.querySelector('[data-layer-color="#61d7f4"]')).not.toBeNull();
    expect(host.querySelector('[data-layer-color="#f0ad55"]')).toBeNull();
    act(() => button('Candidate')?.click());
    expect(host.querySelector('[data-layer-color="#61d7f4"]')).toBeNull();
    expect(host.querySelector('[data-layer-color="#f0ad55"]')).not.toBeNull();
    act(() => button('Grid')?.click());
    expect(host.querySelector('[data-testid="scale-aware-grid"]')).toBeNull();
    act(() => button('Section plane')?.click());
    expect(labelledControl('CAD X')).not.toBeNull();
    expect(labelledControl('CAD Y')).not.toBeNull();
    expect(labelledControl('CAD Z')).not.toBeNull();
    expect(labelledControl('Section position')).not.toBeNull();
    act(() => button('CAD Y')?.click());
    act(() => {
      setRangeValue(labelledControl('Section position') as HTMLInputElement, 10);
    });
    expect(host.querySelector('[data-layer-color="#f0ad55"]')?.getAttribute('data-clipping')).toBe(
      JSON.stringify({ axis: 'z', position: -10, flip: true })
    );
    act(() => button('Flip section')?.click());
    expect(host.querySelector('[data-layer-color="#f0ad55"]')?.getAttribute('data-clipping')).toBe(
      JSON.stringify({ axis: 'z', position: -10, flip: false })
    );
  });

  it('labels configured, verified, and failed Reference states truthfully', async () => {
    const pendingComparison = deferred<Response>();
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) =>
        requestUrl(input) === '/api/workbench'
          ? Promise.resolve(jsonResponse(success(catalog())))
          : pendingComparison.promise
      )
    );

    act(() => {
      root.render(createElement(App));
    });
    await waitFor(
      () =>
        host.querySelector('.reference-status')?.textContent.includes('Infra-Bridge.ifc') === true
    );

    const status = host.querySelector('.reference-status');
    expect(status?.classList.contains('reference-status--pending')).toBe(true);
    expect(status?.textContent).toContain('verification pending');
    expect(status?.textContent).not.toContain('checksum verified');
    expect(host.querySelector('.footer-ledger')?.textContent).toContain('Awaiting models');

    await act(async () => {
      pendingComparison.resolve(jsonResponse(success(overallDiagnostic())));
      await Promise.resolve();
    });
    await waitFor(
      () =>
        host
          .querySelector('.reference-status')
          ?.classList.contains('reference-status--verified') === true
    );
    expect(host.querySelector('.reference-status')?.textContent).toContain('checksum verified');
  });

  it('filters grouped Semantic Keys and keeps the selected component during recompute', async () => {
    let comparisonCalls = 0;
    const pendingRefresh = deferred<Response>();
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url = requestUrl(input);
        if (url === '/api/workbench') return Promise.resolve(jsonResponse(success(catalog())));
        if (url === '/api/workbench/overall') {
          return Promise.resolve(jsonResponse(success(overallDiagnostic())));
        }
        comparisonCalls += 1;
        if (init?.method === 'POST') return pendingRefresh.promise;
        return Promise.resolve(jsonResponse(success(diagnostic())));
      })
    );

    act(() => {
      root.render(createElement(App));
    });
    await openManifestProducts();
    await waitFor(() => host.textContent.includes('Surface P95'));

    const search = labelledControl('Search Semantic Keys') as HTMLInputElement;
    act(() => {
      setInputValue(search, 'deck');
    });
    expect(host.textContent).toContain('Bridge Deck');
    expect(host.querySelector(`[data-semantic-key="${FIRST}"]`)).toBeNull();

    act(() => {
      setInputValue(search, '');
    });
    const selected = host.querySelector(`[data-semantic-key="${FIRST}"]`);
    expect(selected?.getAttribute('aria-current')).toBe('true');

    act(() => {
      button('Recompute')?.click();
    });
    expect(host.textContent).toContain('Previous successful result');
    expect(host.querySelector(`[data-semantic-key="${FIRST}"]`)?.getAttribute('aria-current')).toBe(
      'true'
    );

    pendingRefresh.resolve(jsonResponse(success({ ...diagnostic(), revision: 8 })));
    await waitFor(() => host.textContent.includes('Revision 8'));
    expect(comparisonCalls).toBe(2);
  });

  it('turns structured failures into an actionable alert with retry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => {
        const url = requestUrl(input);
        return Promise.resolve(
          jsonResponse(
            url === '/api/workbench'
              ? success(catalog())
              : url === '/api/workbench/overall'
                ? success(overallDiagnostic())
                : {
                    ok: false,
                    revision: 7,
                    error: {
                      stage: 'checksum',
                      code: 'CHECKSUM_MISMATCH',
                      message: 'Configured reference does not match its manifest.',
                      context: { expected: 'abc', actual: 'def' },
                      retryable: true,
                      action: 'Choose the checksummed Infra-Bridge.ifc and retry.',
                    },
                  }
          )
        );
      })
    );

    act(() => {
      root.render(createElement(App));
    });
    await openManifestProducts();
    await waitFor(() => host.querySelector('.diagnostic-error') !== null);

    const alert = host.querySelector('.diagnostic-error');
    expect(alert?.textContent).toContain('Checksum');
    expect(alert?.textContent).toContain('CHECKSUM_MISMATCH');
    expect(alert?.textContent).toContain('Choose the checksummed Infra-Bridge.ifc and retry.');
    expect(alert?.textContent).toContain('expected');
    expect(button('Retry')).not.toBeNull();
    expect(host.querySelector('.viewport-failure')?.textContent).toContain(
      'Configured reference does not match its manifest.'
    );
    expect(host.querySelector('.viewport-loading')).toBeNull();
    expect(host.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(host.querySelector('.viewport-failure')?.getAttribute('aria-live')).toBeNull();
    expect(host.querySelector('.status-footer')?.getAttribute('aria-live')).toBe('off');
    expect(
      host.querySelector('.reference-status')?.classList.contains('reference-status--failed')
    ).toBe(true);
    expect(host.querySelector('.reference-status')?.textContent).toContain('verification failed');
    expect(host.querySelector('.reference-status')?.textContent).not.toContain('checksummed');
  });

  it('keeps same-key framing stable until Fit and then frames only active visible layers', async () => {
    let comparisonCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => {
        const url = requestUrl(input);
        if (url === '/api/workbench') return Promise.resolve(jsonResponse(success(catalog())));
        if (url === '/api/workbench/overall') {
          return Promise.resolve(jsonResponse(success(overallDiagnostic())));
        }
        comparisonCalls += 1;
        return Promise.resolve(
          jsonResponse(
            success(
              comparisonCalls === 1
                ? diagnostic({ candidateX: 100, revision: 7 })
                : diagnostic({ candidateX: 200, revision: 8 })
            )
          )
        );
      })
    );

    act(() => {
      root.render(createElement(App));
    });
    await openManifestProducts();
    await waitFor(() => framingMaximum() === 110);

    act(() => button('Recompute')?.click());
    await waitFor(() => host.textContent.includes('Revision 8'));
    expect(framingMaximum()).toBe(110);

    act(() => button('Fit')?.click());
    expect(framingMaximum()).toBe(210);

    act(() => button('Candidate visible')?.click());
    expect(framingMaximum()).toBe(10);
    act(() => button('Candidate visible')?.click());
    expect(framingMaximum()).toBe(210);

    act(() => button('Reference')?.click());
    expect(framingMaximum()).toBe(10);
  });

  it('keeps and labels the previous same-key result when recompute fails', async () => {
    const comparisonMethods: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url = requestUrl(input);
        if (url === '/api/workbench') return Promise.resolve(jsonResponse(success(catalog())));
        if (url === '/api/workbench/overall') {
          return Promise.resolve(jsonResponse(success(overallDiagnostic())));
        }
        comparisonMethods.push(init?.method ?? 'GET');
        if (init?.method === 'POST') {
          return Promise.resolve(
            jsonResponse({
              ok: false,
              revision: 8,
              error: {
                stage: 'authored-evaluation',
                code: 'FAMILY_EVALUATION_FAILED',
                message: 'The edited Family could not be evaluated.',
                context: { semanticKey: FIRST },
                retryable: true,
                action: 'Fix the TSX evaluation error and retry.',
              },
            })
          );
        }
        return Promise.resolve(jsonResponse(success(diagnostic())));
      })
    );

    act(() => {
      root.render(createElement(App));
    });
    await openManifestProducts();
    await waitFor(() => host.textContent.includes('Surface P95'));
    act(() => button('Recompute')?.click());
    await waitFor(() => host.textContent.includes('FAMILY_EVALUATION_FAILED'));

    expect(host.textContent).toContain('Previous successful result');
    expect(host.querySelector('[data-testid="shared-r3f-canvas"]')).not.toBeNull();
    expect(host.textContent).toContain('Fix the TSX evaluation error and retry.');
    expect(host.querySelector('.status-footer')?.textContent).toContain('Revision 8');
    expect(host.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(host.querySelector('.reference-status')?.textContent).toContain('checksum verified');

    act(() => button('Retry')?.click());
    await waitFor(() => comparisonMethods.length === 3);
    expect(comparisonMethods).toEqual(['GET', 'POST', 'POST']);
  });

  it('leaves the busy state and reports the actual revision of a stale recompute response', async () => {
    let comparisonCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => {
        const url = requestUrl(input);
        if (url === '/api/workbench') return Promise.resolve(jsonResponse(success(catalog())));
        if (url === '/api/workbench/overall') {
          return Promise.resolve(jsonResponse(success(overallDiagnostic({ revision: 8 }))));
        }
        comparisonCalls += 1;
        return Promise.resolve(
          jsonResponse(success(diagnostic({ revision: comparisonCalls === 1 ? 8 : 7 })))
        );
      })
    );

    act(() => {
      root.render(createElement(App));
    });
    await openManifestProducts();
    await waitFor(() => host.textContent.includes('Revision 8'));

    act(() => button('Recompute')?.click());
    await waitFor(() => host.textContent.includes('stale-revision-response'));

    expect(host.querySelector('.viewport-loading')).toBeNull();
    expect(host.querySelector('.diagnostic-error')?.textContent).toContain('older source revision');
    expect(button('Recompute')?.disabled).toBe(false);
    expect(host.querySelector('.status-footer')?.textContent).toContain('Revision 7');
    expect(host.textContent).toContain('Previous successful result');
  });

  it('renders failed, not-applicable, and unavailable gates with units and thresholds', async () => {
    const passing = diagnostic({ revision: 7 });
    const failed: ComparisonDiagnostic = {
      ...passing,
      pass: false,
      score: { ...passing.score, volume: undefined, closedSolidIoU: undefined },
      gates: passing.gates.map((gate) =>
        gate.id === 'surface-maximum'
          ? { ...gate, status: 'fail' }
          : gate.id === 'normal-mean'
            ? { ...gate, status: 'not-applicable', value: null }
            : gate.id === 'volume-relative-error'
              ? { ...gate, status: 'unavailable', value: null }
              : gate
      ),
    };
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) =>
        Promise.resolve(
          jsonResponse(
            requestUrl(input) === '/api/workbench'
              ? success(catalog())
              : requestUrl(input) === '/api/workbench/overall'
                ? success(overallDiagnostic())
                : success(failed)
          )
        )
      )
    );

    act(() => {
      root.render(createElement(App));
    });
    await openManifestProducts();
    await waitFor(() => host.querySelector('.outcome-badge--fail') !== null);

    expect(host.querySelector('.metric-status--fail')?.textContent).toContain('Fail');
    expect(host.querySelector('.metric-status--fail')?.textContent).toContain('≤ 75.00 mm');
    expect(host.querySelector('.metric-status--not-applicable')?.textContent).toContain('N/A');
    expect(host.querySelector('.metric-status--not-applicable')?.textContent).toContain(
      '≥ 0.99000'
    );
    expect(host.querySelector('.metric-status--unavailable')?.textContent).toContain('Unavailable');
    expect(host.textContent).toContain('0.030 mm');
    expect(host.textContent).toContain('Not available');
  });

  function button(name: string): HTMLButtonElement | null {
    return (
      Array.from(host.querySelectorAll('button')).find(
        (candidate) =>
          candidate.getAttribute('aria-label') === name || candidate.textContent === name
      ) ?? null
    );
  }

  function labelledControl(label: string): HTMLElement | null {
    return host.querySelector(`[aria-label="${label}"]`);
  }

  async function openManifestProducts(): Promise<void> {
    await waitFor(() => button('Manifest products') !== null);
    act(() => button('Manifest products')?.click());
    await waitFor(() => labelledControl('Search Semantic Keys') !== null);
  }

  function framingMaximum(): number {
    const value = host
      .querySelector('[data-testid="shared-r3f-canvas"]')
      ?.getAttribute('data-framing-maximum');
    return value === null || value === undefined ? Number.NaN : Number(value);
  }
});

function catalog(): WorkbenchCatalog {
  return {
    title: 'Infra-bridge Reconstruction Workbench',
    products: [
      {
        semanticKey: FIRST,
        group: 'Rail bridge 01',
        label: 'Arch Segment 01',
        detail: 'Superstructure / Arch Segment 01',
      },
      {
        semanticKey: SECOND,
        group: 'Road river bridge',
        label: 'Bridge Deck',
        detail: 'Deck / Bridge Deck',
      },
    ],
    reference: {
      path: '/private/reference/Infra-Bridge.ifc',
      fileName: 'Infra-Bridge.ifc',
      expectedChecksum: 'abcdef0123456789',
      productCount: 2,
    },
    sourceRevision: 7,
  };
}

function diagnostic(
  options: { readonly candidateX?: number; readonly revision?: number } = {}
): ComparisonDiagnostic {
  const frame = {
    origin: [10, 20, 30] as const,
    xAxis: [1, 0, 0] as const,
    zAxis: [0, 0, 1] as const,
  };
  const surface = {
    unit: 'millimetre' as const,
    vertices: [
      [0, 0, 0],
      [10, 0, 0],
      [0, 20, 0],
    ] as const,
    triangles: [[0, 1, 2]] as const,
    closed: true,
  };
  const candidateX = options.candidateX ?? 0;
  const candidateSurface = {
    ...surface,
    vertices: surface.vertices.map(([x, y, z]) => [x + candidateX, y, z] as const),
  };
  return {
    semanticKey: FIRST,
    revision: options.revision ?? 7,
    durationMs: 184,
    computedAt: '2026-08-20T08:00:00.000Z',
    coordinateSpace: 'canonical-component-local',
    surfaces: { reference: surface, candidate: candidateSurface },
    frames: {
      referenceLocal: frame,
      referenceWorld: frame,
      canonicalWorld: frame,
      candidateLocal: frame,
      candidateWorld: frame,
    },
    frameDeltas: {
      controlPointDeltaMm: 0.012,
      xAxisDeltaDegrees: 0.001,
      zAxisDeltaDegrees: 0.002,
    },
    score: {
      surfaceDistance: { maximumMm: 0.12, meanMm: 0.03, p95Mm: 0.08, areaSampleCount: 96 },
      normalAgreement: { meanCosine: 0.9999, minimumCosine: 0.998 },
      envelope: {
        deltasMm: { xMin: 0.01, xMax: -0.01, yMin: 0.02, yMax: 0, zMin: 0, zMax: 0 },
        maximumAbsoluteDeltaMm: 0.02,
      },
      volume: { targetMm3: 1000, candidateMm3: 999, relativeError: 0.001 },
      closedSolidIoU: { value: 0.997, method: 'voxel-32' },
    },
    gates: [
      gate('frame-control-point', 0.012, 5, 'at-most', 'millimetre'),
      gate('frame-x-axis', 0.001, 0.01, 'at-most', 'degree'),
      gate('frame-z-axis', 0.002, 0.01, 'at-most', 'degree'),
      gate('envelope-maximum', 0.02, 2, 'at-most', 'millimetre'),
      gate('surface-p95', 0.08, 25, 'at-most', 'millimetre'),
      gate('surface-maximum', 0.12, 75, 'at-most', 'millimetre'),
      gate('normal-mean', 0.9999, 0.99, 'at-least', 'ratio'),
      gate('volume-relative-error', 0.001, 0.02, 'at-most', 'ratio'),
    ],
    pass: true,
  };
}

function overallDiagnostic(options: { readonly revision?: number } = {}): OverallDiagnostic {
  const surface = diagnostic().surfaces.reference;
  return {
    revision: options.revision ?? 7,
    durationMs: 318,
    computedAt: '2026-08-20T08:00:00.000Z',
    coordinateSpace: 'world',
    productCount: 2,
    surfaces: {
      reference: surface,
      candidate: {
        ...surface,
        vertices: surface.vertices.map(([x, y, z]) => [x + 40, y, z] as const),
      },
    },
  };
}

function componentSourceDiagnostic(semanticKey: string = FIRST): ComponentSourceDiagnostic {
  const bridgeDeck = semanticKey === SECOND;
  const definitionName = bridgeDeck ? 'BridgeDeck' : 'ArchSegment';
  const fileName = bridgeDeck ? 'bridgeDeck.tsx' : 'archSegment.tsx';
  return {
    semanticKey,
    revision: 7,
    durationMs: 94,
    computedAt: '2026-08-20T08:00:00.000Z',
    definitionName,
    coordinateSpace: 'canonical-component-local',
    source: {
      fileName,
      path: `examples/infra-bridge/src/families/${fileName}`,
      language: 'tsx',
      text: `export const ${definitionName} = family();\n\n// Candidate geometry`,
      highlightedHtml: `<pre class="shiki shiki-themes"><code><span class="line" data-line="1">export const ${definitionName}</span>\n<span class="line" data-line="2"></span>\n<span class="line" data-line="3">// Candidate geometry</span></code></pre>`,
    },
    candidate: diagnostic().surfaces.candidate,
  };
}

function gate(
  id: ComparisonDiagnostic['gates'][number]['id'],
  value: number,
  threshold: number,
  relation: ComparisonDiagnostic['gates'][number]['relation'],
  unit: ComparisonDiagnostic['gates'][number]['unit']
): ComparisonDiagnostic['gates'][number] {
  return { id, value, threshold, relation, unit, status: 'pass' };
}

function matchMediaStub(matches: boolean) {
  return vi.fn((): MediaQueryList => ({
    matches,
    media: '(prefers-color-scheme: light)',
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  }));
}

function success<T>(value: T): WorkbenchResult<T> {
  const revision = 'revision' in (value as object) ? (value as { revision: number }).revision : 7;
  return { ok: true, revision, value };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function deferred<T>() {
  let resolve: ((value: T) => void) | undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return {
    promise,
    resolve(value: T) {
      if (resolve === undefined) throw new Error('Deferred promise is not initialized');
      resolve(value);
    },
  };
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (condition()) return;
    await act(async () => {
      await Promise.resolve();
    });
  }
  throw new Error('condition was not reached');
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.bind(
    input
  );
  setter?.(value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function setRangeValue(input: HTMLInputElement, value: number): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.bind(
    input
  );
  setter?.(value.toString());
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function requestUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}
