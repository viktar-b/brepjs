import type { ViewerColorScheme } from './types.js';

export default function SceneLighting({
  colorScheme = 'dark',
}: {
  colorScheme?: ViewerColorScheme | undefined;
}) {
  return (
    <>
      <hemisphereLight args={['#ffffff', colorScheme === 'light' ? '#c8d5da' : '#1a1a2e', 0.65]} />
      <directionalLight position={[-50, 60, 80]} intensity={0.85} color="#fff8f0" />
      <directionalLight position={[40, -40, 30]} intensity={0.15} color="#e0e8ff" />
    </>
  );
}
