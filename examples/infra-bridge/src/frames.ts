import { frame, type Frame } from 'brepjs-families';

/** Create a right-handed rigid Frame from a plan yaw and an authored control point. */
export function yawFrame(origin: readonly [number, number, number], degrees = 0): Frame {
  const radians = (degrees * Math.PI) / 180;
  return frame({
    origin,
    xAxis: [Math.cos(radians), Math.sin(radians), 0],
    zAxis: [0, 0, 1],
  });
}
