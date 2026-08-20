// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialWorkbenchUiState } from '../src/uiState.js';
import { WorkbenchViewport } from '../src/WorkbenchViewport.js';

vi.mock('brepjs-viewer', () => ({
  EdgeRenderer: () => null,
  Renderer: () => null,
  ViewerCanvas: () => null,
  meshBounds: () => ({ min: [0, 0, 0], max: [0, 0, 0] }),
  sectionPlane: () => ({}),
}));

vi.mock('@react-three/drei', () => ({ Grid: () => null }));

describe('comparison viewport controls', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it('labels a layer-adjusted preset as a custom view when controls are collapsed', () => {
    const ui = {
      ...createInitialWorkbenchUiState(),
      presetIsCustomized: true,
    };

    act(() => {
      root.render(
        createElement(WorkbenchViewport, {
          diagnostic: undefined,
          error: undefined,
          busy: false,
          ui,
          dispatch: vi.fn(),
          onRetry: undefined,
        })
      );
    });

    const summaryValue = host.querySelector('.viewport-controls summary span:last-child');
    expect(summaryValue?.textContent).toBe('Custom view');
  });
});
