import { describe, expect, it } from 'vitest';
import { createInitialWorkbenchUiState, workbenchUiReducer } from '../src/uiState.js';

describe('workbench UI state', () => {
  it('applies the three diagnostic presets exactly', () => {
    const initial = createInitialWorkbenchUiState();

    const reference = workbenchUiReducer(initial, {
      type: 'apply-preset',
      preset: 'reference',
    });
    expect(reference.layers).toEqual({
      reference: { visible: true, xray: false, edges: true },
      candidate: { visible: false, xray: false, edges: true },
    });

    const candidate = workbenchUiReducer(reference, {
      type: 'apply-preset',
      preset: 'candidate',
    });
    expect(candidate.layers).toEqual({
      reference: { visible: false, xray: false, edges: true },
      candidate: { visible: true, xray: false, edges: true },
    });
    expect(candidate.camera.fitRequest).toBe(2);

    const overlay = workbenchUiReducer(candidate, {
      type: 'apply-preset',
      preset: 'overlay',
    });
    expect(overlay.layers).toEqual({
      reference: { visible: true, xray: true, edges: false },
      candidate: { visible: true, xray: false, edges: true },
    });
    expect(overlay.activePreset).toBe('overlay');
    expect(overlay.presetIsCustomized).toBe(false);
    expect(overlay.camera.fitRequest).toBe(3);
  });

  it('keeps independent layer edits and records that a preset was customized', () => {
    const overlay = createInitialWorkbenchUiState();
    const withoutCandidateEdges = workbenchUiReducer(overlay, {
      type: 'set-layer',
      layer: 'candidate',
      control: 'edges',
      value: false,
    });
    const opaqueReference = workbenchUiReducer(withoutCandidateEdges, {
      type: 'set-layer',
      layer: 'reference',
      control: 'xray',
      value: false,
    });

    expect(opaqueReference.layers.reference).toEqual({
      visible: true,
      xray: false,
      edges: false,
    });
    expect(opaqueReference.layers.candidate).toEqual({
      visible: true,
      xray: false,
      edges: false,
    });
    expect(opaqueReference.presetIsCustomized).toBe(true);
  });

  it('preserves view controls on selection and fits only when the key changes', () => {
    const initial = createInitialWorkbenchUiState('infra-bridge/a');
    const adjusted = [
      { type: 'set-camera-preset', preset: 'top' } as const,
      { type: 'set-projection', projection: 'orthographic' } as const,
      { type: 'set-grid', visible: false } as const,
      { type: 'set-section-enabled', enabled: true } as const,
      { type: 'set-section-axis', axis: 'y' } as const,
      { type: 'set-section-flipped', flipped: true } as const,
    ].reduce(workbenchUiReducer, initial);

    const recomputed = workbenchUiReducer(adjusted, {
      type: 'select',
      semanticKey: 'infra-bridge/a',
    });
    expect(recomputed).toEqual(adjusted);

    const selected = workbenchUiReducer(recomputed, {
      type: 'select',
      semanticKey: 'infra-bridge/b',
    });
    expect(selected.selectedSemanticKey).toBe('infra-bridge/b');
    expect(selected.camera).toEqual({
      preset: 'top',
      presetRequest: 1,
      projection: 'orthographic',
      gridVisible: false,
      fitRequest: 1,
    });
    expect(selected.section).toMatchObject({ enabled: true, axis: 'y', flipped: true });
  });

  it('clamps the section position to its current range and exposes repeatable camera commands', () => {
    const initial = createInitialWorkbenchUiState();
    const ranged = workbenchUiReducer(initial, {
      type: 'set-section-range',
      minimumMm: -20,
      maximumMm: 80,
    });
    const clipped = workbenchUiReducer(ranged, {
      type: 'set-section-position',
      positionMm: 120,
    });
    const cameraOnce = workbenchUiReducer(clipped, {
      type: 'set-camera-preset',
      preset: 'iso',
    });
    const cameraTwice = workbenchUiReducer(cameraOnce, {
      type: 'set-camera-preset',
      preset: 'iso',
    });
    const fitted = workbenchUiReducer(cameraTwice, { type: 'request-fit' });

    expect(clipped.section.positionMm).toBe(80);
    expect(cameraTwice.camera.presetRequest).toBe(2);
    expect(fitted.camera.fitRequest).toBe(1);
  });
});
