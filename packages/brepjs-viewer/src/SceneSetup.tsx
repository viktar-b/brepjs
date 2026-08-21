import { OrbitControls } from '@react-three/drei';
import type { ComponentRef, RefObject } from 'react';
import type { Vector3Tuple } from 'three';
import GradientBackground from './GradientBackground.js';
import InfiniteGrid from './InfiniteGrid.js';
import SceneLighting from './SceneLighting.js';
import type { ViewerColorScheme } from './types.js';

export type OrbitControlsHandle = ComponentRef<typeof OrbitControls>;

export interface ControlsProps {
  enableDamping?: boolean;
  dampingFactor?: number;
  rotateSpeed?: number;
  zoomSpeed?: number;
  enablePan?: boolean;
  minDistance?: number;
  maxDistance?: number;
  minPolarAngle?: number;
  maxPolarAngle?: number;
}

interface GridProps {
  cellSize?: number;
  lineColor?: string;
  lineOpacity?: number;
  fadeStart?: number;
  fadeEnd?: number;
}

interface SceneSetupProps {
  autoRotate?: boolean;
  colorScheme?: ViewerColorScheme;
  target?: Vector3Tuple;
  gridVisible?: boolean;
  gridProps?: GridProps;
  controlsProps?: ControlsProps;
  controlsRef?: RefObject<OrbitControlsHandle | null>;
  onControlsStart?: () => void;
}

export default function SceneSetup({
  autoRotate = false,
  colorScheme = 'dark',
  target,
  gridVisible = true,
  gridProps,
  controlsProps,
  controlsRef,
  onControlsStart,
}: SceneSetupProps) {
  const optionalControls = {
    ...(controlsRef ? { ref: controlsRef } : {}),
    ...(target ? { target } : {}),
    ...(onControlsStart ? { onStart: onControlsStart } : {}),
  };
  return (
    <>
      <SceneLighting colorScheme={colorScheme} />
      <GradientBackground
        colorTop={colorScheme === 'light' ? '#f9fbfc' : '#2a2a3e'}
        colorBottom={colorScheme === 'light' ? '#dce5e8' : '#2a2a3e'}
      />
      <OrbitControls
        makeDefault
        autoRotate={autoRotate}
        autoRotateSpeed={1.5}
        {...optionalControls}
        {...controlsProps}
      />
      {gridVisible && <InfiniteGrid {...gridProps} />}
    </>
  );
}
