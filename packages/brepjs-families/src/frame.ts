import { csg } from 'brepjs';

export type FrameVector = readonly [number, number, number];

/** A right-handed rigid placement. The Y axis is derived as Z × X. */
export interface Frame {
  readonly origin: FrameVector;
  readonly xAxis: FrameVector;
  readonly zAxis: FrameVector;
}

const TOLERANCE = 1e-9;

export const IDENTITY_FRAME: Frame = Object.freeze({
  origin: Object.freeze([0, 0, 0] as const),
  xAxis: Object.freeze([1, 0, 0] as const),
  zAxis: Object.freeze([0, 0, 1] as const),
});

function dot(a: FrameVector, b: FrameVector): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: FrameVector, b: FrameVector): FrameVector {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function length(v: FrameVector): number {
  return Math.hypot(v[0], v[1], v[2]);
}

function clean(value: number): number {
  if (Math.abs(value) < TOLERANCE) return 0;
  if (Math.abs(value - 1) < TOLERANCE) return 1;
  if (Math.abs(value + 1) < TOLERANCE) return -1;
  return value;
}

function cleaned(v: FrameVector): FrameVector {
  return [clean(v[0]), clean(v[1]), clean(v[2])];
}

function withSign(magnitude: number, signSource: number): number {
  return signSource < 0 ? -magnitude : magnitude;
}

function validateVector(name: string, value: FrameVector, unit: boolean): void {
  if (value.length !== 3 || value.some((coordinate) => !Number.isFinite(coordinate))) {
    throw new Error(`brepjs-families: Frame ${name} must contain three finite numbers`);
  }
  if (unit && Math.abs(length(value) - 1) > TOLERANCE) {
    throw new Error(`brepjs-families: Frame ${name} must be a unit vector`);
  }
}

/** Validate and freeze a rigid Frame at the authored Interface. */
export function frame(value: Frame): Frame {
  validateVector('origin', value.origin, false);
  validateVector('xAxis', value.xAxis, true);
  validateVector('zAxis', value.zAxis, true);
  if (Math.abs(dot(value.xAxis, value.zAxis)) > TOLERANCE) {
    throw new Error('brepjs-families: Frame xAxis and zAxis must be orthogonal');
  }
  return Object.freeze({
    origin: Object.freeze(cleaned(value.origin)),
    xAxis: Object.freeze(cleaned(value.xAxis)),
    zAxis: Object.freeze(cleaned(value.zAxis)),
  });
}

function yAxis(value: Frame): FrameVector {
  return cleaned(cross(value.zAxis, value.xAxis));
}

function transformVector(parent: Frame, value: FrameVector): FrameVector {
  const y = yAxis(parent);
  return cleaned([
    parent.xAxis[0] * value[0] + y[0] * value[1] + parent.zAxis[0] * value[2],
    parent.xAxis[1] * value[0] + y[1] * value[1] + parent.zAxis[1] * value[2],
    parent.xAxis[2] * value[0] + y[2] * value[1] + parent.zAxis[2] * value[2],
  ]);
}

export function composeFrames(parent: Frame, local: Frame): Frame {
  const offset = transformVector(parent, local.origin);
  return frame({
    origin: [
      parent.origin[0] + offset[0],
      parent.origin[1] + offset[1],
      parent.origin[2] + offset[2],
    ],
    xAxis: transformVector(parent, local.xAxis),
    zAxis: transformVector(parent, local.zAxis),
  });
}

function isIdentity(value: Frame): boolean {
  return (
    value.origin[0] === 0 &&
    value.origin[1] === 0 &&
    value.origin[2] === 0 &&
    value.xAxis[0] === 1 &&
    value.xAxis[1] === 0 &&
    value.xAxis[2] === 0 &&
    value.zAxis[0] === 0 &&
    value.zAxis[1] === 0 &&
    value.zAxis[2] === 1
  );
}

function axisAngle(value: Frame): { readonly angle: number; readonly axis: FrameVector } {
  const x = value.xAxis;
  const y = yAxis(value);
  const z = value.zAxis;
  const rows = [
    [x[0], y[0], z[0]],
    [x[1], y[1], z[1]],
    [x[2], y[2], z[2]],
  ] as const;
  const cosine = Math.max(-1, Math.min(1, (rows[0][0] + rows[1][1] + rows[2][2] - 1) / 2));
  const radians = Math.acos(cosine);
  if (radians < TOLERANCE) return { angle: 0, axis: [0, 0, 1] };
  if (Math.PI - radians < 1e-7) {
    const xx = Math.sqrt(Math.max(0, (rows[0][0] + 1) / 2));
    const yy = Math.sqrt(Math.max(0, (rows[1][1] + 1) / 2));
    const zz = Math.sqrt(Math.max(0, (rows[2][2] + 1) / 2));
    const candidate: FrameVector = [
      xx,
      withSign(yy, rows[0][1] + rows[1][0]),
      withSign(zz, rows[0][2] + rows[2][0]),
    ];
    const magnitude = length(candidate);
    return {
      angle: 180,
      axis:
        magnitude < TOLERANCE
          ? [1, 0, 0]
          : [candidate[0] / magnitude, candidate[1] / magnitude, candidate[2] / magnitude],
    };
  }
  const denominator = 2 * Math.sin(radians);
  const axis: FrameVector = [
    (rows[2][1] - rows[1][2]) / denominator,
    (rows[0][2] - rows[2][0]) / denominator,
    (rows[1][0] - rows[0][1]) / denominator,
  ];
  return { angle: (radians * 180) / Math.PI, axis };
}

export function applyFrame(node: csg.IRNode, value: Frame): csg.IRNode {
  if (node.kind === 'Empty' || isIdentity(value)) return node;
  const rotation = axisAngle(value);
  const rotated =
    rotation.angle === 0 ? node : csg.rotate(node, rotation.angle, { axis: rotation.axis });
  return value.origin[0] === 0 && value.origin[1] === 0 && value.origin[2] === 0
    ? rotated
    : csg.translate(rotated, value.origin);
}
