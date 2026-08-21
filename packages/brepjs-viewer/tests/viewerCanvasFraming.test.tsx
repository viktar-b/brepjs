import { act } from 'react';
import type { ReactNode, RefObject } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ViewerCanvas } from '@/ViewerCanvas.js';
import type { MeshData } from '@/types.js';

interface ControlsHandle {
  readonly target: THREE.Vector3;
  readonly update: ReturnType<typeof vi.fn>;
}

interface MockSceneSetupProps {
  readonly controlsRef?: RefObject<ControlsHandle | null> | undefined;
  readonly colorScheme?: 'dark' | 'light' | undefined;
}

const mockState = vi.hoisted(() => ({
  activateOrthographicCamera: undefined as (() => void) | undefined,
  camera: undefined as THREE.Camera | undefined,
  controls: undefined as ControlsHandle | undefined,
  colorScheme: undefined as 'dark' | 'light' | undefined,
  gl: { localClippingEnabled: false },
  invalidate: vi.fn(),
}));

vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { readonly children?: ReactNode }) => <>{children}</>,
  useThree: <Value,>(
    selector: (state: {
      readonly camera: THREE.Camera;
      readonly gl: { localClippingEnabled: boolean };
      readonly invalidate: () => void;
    }) => Value
  ): Value => {
    if (mockState.camera === undefined) throw new Error('mock camera is not ready');
    return selector({
      camera: mockState.camera,
      gl: mockState.gl,
      invalidate: mockState.invalidate,
    });
  },
}));

vi.mock('@react-three/drei', () => ({
  OrthographicCamera: () => {
    mockState.activateOrthographicCamera?.();
    return null;
  },
}));

vi.mock('@/SceneSetup.js', async () => {
  const React = await import('react');
  return {
    default: function MockSceneSetup({ colorScheme, controlsRef }: MockSceneSetupProps) {
      mockState.colorScheme = colorScheme;
      React.useLayoutEffect(() => {
        if (controlsRef === undefined) return;
        controlsRef.current = mockState.controls ?? null;
      });
      return null;
    },
  };
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  mockState.camera = new THREE.PerspectiveCamera();
  mockState.controls = { target: new THREE.Vector3(), update: vi.fn() };
  mockState.activateOrthographicCamera = () => {
    if (mockState.camera instanceof THREE.OrthographicCamera) return;
    mockState.camera = new THREE.OrthographicCamera();
    mockState.controls = { target: new THREE.Vector3(), update: vi.fn() };
  };
  mockState.invalidate.mockClear();
  mockState.colorScheme = undefined;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('ViewerCanvas framing', () => {
  it('keeps OrbitControls focused on the bounds centre across every reframe trigger', () => {
    const perspectiveControls = requireActiveControls();

    renderViewer({ data: meshAt(10), view: 'iso', fitSignal: 0, projection: 'perspective' });
    expectControlsTarget(perspectiveControls, [12, 2, 2], 1);

    renderViewer({ data: meshAt(10), view: 'right', fitSignal: 0, projection: 'perspective' });
    expectControlsTarget(perspectiveControls, [12, 2, 2], 2);

    renderViewer({ data: meshAt(10), view: 'right', fitSignal: 1, projection: 'perspective' });
    expectControlsTarget(perspectiveControls, [12, 2, 2], 3);

    renderViewer({ data: meshAt(10), view: 'right', fitSignal: 1, projection: 'orthographic' });
    const orthographicControls = requireActiveControls();
    expect(orthographicControls).not.toBe(perspectiveControls);
    expectControlsTarget(orthographicControls, [12, 2, 2], 1);
    expect(perspectiveControls.update).toHaveBeenCalledTimes(3);

    renderViewer({ data: meshAt(30), view: 'right', fitSignal: 1, projection: 'orthographic' });
    expectControlsTarget(orthographicControls, [32, 2, 2], 2);
  });

  it('passes the selected color scheme into the WebGL scene', () => {
    act(() => {
      root.render(<ViewerCanvas data={meshAt(10)} colorScheme="light" />);
    });

    expect(mockState.colorScheme).toBe('light');
  });
});

function renderViewer({
  data,
  view,
  fitSignal,
  projection,
}: {
  readonly data: MeshData;
  readonly view: 'iso' | 'right';
  readonly fitSignal: number;
  readonly projection: 'perspective' | 'orthographic';
}): void {
  act(() => {
    root.render(
      <ViewerCanvas data={data} view={view} fitSignal={fitSignal} projection={projection} />
    );
  });
}

function requireActiveControls(): ControlsHandle {
  const controls = mockState.controls;
  if (controls === undefined) throw new Error('mock controls are not ready');
  return controls;
}

function expectControlsTarget(
  controls: ControlsHandle,
  expected: readonly [number, number, number],
  updates: number
): void {
  expect(controls.target.toArray()).toEqual(expected);
  expect(controls.update).toHaveBeenCalledTimes(updates);
  expect(mockState.camera?.position.distanceTo(new THREE.Vector3(...expected))).toBeGreaterThan(0);
}

function meshAt(x: number): MeshData {
  return {
    position: new Float32Array([x, 0, 0, x + 4, 4, 4]),
    normal: new Float32Array([0, 1, 0, 0, 1, 0]),
    index: new Uint32Array([0, 1, 0]),
    edges: new Float32Array([]),
  };
}
