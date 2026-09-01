import type { Vec3 } from '../geometry/model.js';

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, amount: number): Vec3 => [a[0] * amount, a[1] * amount, a[2] * amount];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const length = (a: Vec3) => Math.hypot(...a);
const normalize = (a: Vec3): Vec3 => {
  const magnitude = length(a);
  return magnitude > 1e-9 ? scale(a, 1 / magnitude) : [1, 0, 0];
};
const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value));

function eulerFromColumns(xAxis: Vec3, yAxis: Vec3, zAxis: Vec3): Vec3 {
  const m00 = xAxis[0];
  const m10 = xAxis[1];
  const m20 = xAxis[2];
  const m21 = yAxis[2];
  const m22 = zAxis[2];
  const y = Math.asin(clamp(-m20, -1, 1));
  if (Math.abs(Math.cos(y)) < 1e-7) return [0, y, Math.atan2(-yAxis[0], yAxis[1])];
  return [Math.atan2(m21, m22), y, Math.atan2(m10, m00)];
}

export interface TwoBoneReachInput {
  side: 'left' | 'right';
  origin: Vec3;
  target: Vec3;
  upperLength: number;
  lowerLength: number;
  pole: Vec3;
  minimumBendRadians?: number;
}

export function solveTwoBoneReach(input: TwoBoneReachInput) {
  const targetVector = subtract(input.target, input.origin);
  const rawDistance = length(targetVector);
  const physicalMinimum = Math.abs(input.upperLength - input.lowerLength);
  const physicalMaximum = input.upperLength + input.lowerLength;
  const minimum = physicalMinimum + 1e-5;
  const maximum = physicalMaximum - 1e-5;
  const distance = clamp(rawDistance, minimum, maximum);
  const direction = normalize(targetVector);
  let bend = subtract(input.pole, scale(direction, dot(input.pole, direction)));
  if (length(bend) < 1e-7) bend = Math.abs(direction[1]) < 0.9 ? [0, -1, 0] : [0, 0, 1];
  bend = normalize(bend);
  const along = (input.upperLength ** 2 - input.lowerLength ** 2 + distance ** 2) / (2 * distance);
  const height = Math.sqrt(Math.max(0, input.upperLength ** 2 - along ** 2));
  const elbow = add(input.origin, add(scale(direction, along), scale(bend, height)));
  const upperDirection = normalize(subtract(elbow, input.origin));
  const lowerDirection = normalize(subtract(input.target, elbow));
  let elbowAngle = Math.acos(clamp(dot(upperDirection, lowerDirection), -1, 1));
  elbowAngle = Math.max(input.minimumBendRadians ?? 0.035, elbowAngle);
  let localY = subtract(lowerDirection, scale(upperDirection, dot(upperDirection, lowerDirection)));
  if (length(localY) < 1e-7) localY = bend;
  localY = normalize(localY);
  const sideSign = input.side === 'left' ? 1 : -1;
  const localX = scale(upperDirection, sideSign);
  const localZ = normalize(cross(localX, localY));
  localY = normalize(cross(localZ, localX));
  return {
    reachable: rawDistance <= physicalMaximum + 1e-9 && rawDistance >= physicalMinimum - 1e-9,
    requestedTarget: input.target,
    resolvedTarget: add(input.origin, scale(direction, distance)),
    elbow,
    shoulderRotation: eulerFromColumns(localX, localY, localZ),
    elbowRotation: [0, 0, sideSign * elbowAngle] as Vec3,
    endpointErrorMeters: Math.abs(rawDistance - distance),
    bendRadians: elbowAngle,
  };
}

function rotateEuler([x, y, z]: Vec3, [rx, ry, rz]: Vec3): Vec3 {
  const cx = Math.cos(rx);
  const sx = Math.sin(rx);
  const cy = Math.cos(ry);
  const sy = Math.sin(ry);
  const cz = Math.cos(rz);
  const sz = Math.sin(rz);
  const afterX: Vec3 = [x, y * cx - z * sx, y * sx + z * cx];
  const afterY: Vec3 = [
    afterX[0] * cy + afterX[2] * sy,
    afterX[1],
    -afterX[0] * sy + afterX[2] * cy,
  ];
  return [afterY[0] * cz - afterY[1] * sz, afterY[0] * sz + afterY[1] * cz, afterY[2]];
}

export function forwardReachEndpoint(
  input: TwoBoneReachInput,
  solution: ReturnType<typeof solveTwoBoneReach>,
) {
  const sideSign = input.side === 'left' ? 1 : -1;
  const upper = rotateEuler([sideSign * input.upperLength, 0, 0], solution.shoulderRotation);
  const lowerLocal = rotateEuler([sideSign * input.lowerLength, 0, 0], solution.elbowRotation);
  const lower = rotateEuler(lowerLocal, solution.shoulderRotation);
  return add(input.origin, add(upper, lower));
}
