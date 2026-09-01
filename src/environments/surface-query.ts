import type { GeometryAsset, Vec3 } from '../geometry/model.js';
import type { SceneTransform } from '../interactions/model.js';

export interface SurfaceHit {
  position: Vec3;
  normal: Vec3;
  triangleIndex: number;
  slopeDegrees: number;
}

export type SurfaceQuery = (x: number, z: number) => SurfaceHit | undefined;
export interface SurfaceQueryProvider {
  geometryAssetId: string;
  query: SurfaceQuery;
}

const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const normalize = (value: Vec3): Vec3 => {
  const length = Math.hypot(...value);
  return length > 1e-12 ? [value[0] / length, value[1] / length, value[2] / length] : [0, 1, 0];
};

function transformPoint(point: Vec3, transform: SceneTransform): Vec3 {
  let [x, y, z] = point.map((value, index) => value * transform.scale[index]!) as Vec3;
  const [rx, ry, rz] = transform.rotation;
  [y, z] = [y * Math.cos(rx) - z * Math.sin(rx), y * Math.sin(rx) + z * Math.cos(rx)];
  [x, z] = [x * Math.cos(ry) + z * Math.sin(ry), -x * Math.sin(ry) + z * Math.cos(ry)];
  [x, y] = [x * Math.cos(rz) - y * Math.sin(rz), x * Math.sin(rz) + y * Math.cos(rz)];
  return [x + transform.position[0], y + transform.position[1], z + transform.position[2]];
}

function barycentricXZ(point: [number, number], a: Vec3, b: Vec3, c: Vec3) {
  const denominator = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
  if (Math.abs(denominator) < 1e-10) return undefined;
  const first =
    ((b[2] - c[2]) * (point[0] - c[0]) + (c[0] - b[0]) * (point[1] - c[2])) / denominator;
  const second =
    ((c[2] - a[2]) * (point[0] - c[0]) + (a[0] - c[0]) * (point[1] - c[2])) / denominator;
  const third = 1 - first - second;
  return first >= -1e-8 && second >= -1e-8 && third >= -1e-8
    ? ([first, second, third] as const)
    : undefined;
}

export function createTriangleSurfaceQuery(
  geometry: GeometryAsset,
  transform: SceneTransform = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
): SurfaceQueryProvider {
  const positions = geometry.positions.map((point) => transformPoint(point, transform));
  const query: SurfaceQuery = (x, z) => {
    let best: SurfaceHit | undefined;
    for (let index = 0; index < geometry.indices.length; index += 3) {
      const a = positions[geometry.indices[index]!]!;
      const b = positions[geometry.indices[index + 1]!]!;
      const c = positions[geometry.indices[index + 2]!]!;
      const weights = barycentricXZ([x, z], a, b, c);
      if (!weights) continue;
      const y = a[1] * weights[0] + b[1] * weights[1] + c[1] * weights[2];
      let normal = normalize(cross(subtract(b, a), subtract(c, a)));
      if (normal[1] < 0) normal = [-normal[0], -normal[1], -normal[2]];
      if (normal[1] < 1e-6) continue;
      const hit = {
        position: [x, y, z] as Vec3,
        normal,
        triangleIndex: index / 3,
        slopeDegrees: (Math.acos(Math.max(-1, Math.min(1, normal[1]))) * 180) / Math.PI,
      };
      if (!best || hit.position[1] > best.position[1]) best = hit;
    }
    return best;
  };
  return { geometryAssetId: geometry.id, query };
}

type Quaternion = [number, number, number, number];
const multiplyQuaternion = (a: Quaternion, b: Quaternion): Quaternion => [
  a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
  a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
  a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
  a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
];

export function surfaceAlignedEuler(normalInput: Vec3, yawRadians: number): Vec3 {
  const normal = normalize(normalInput);
  const axis = normalize(cross([0, 1, 0], normal));
  const angle = Math.acos(Math.max(-1, Math.min(1, normal[1])));
  const tilt: Quaternion =
    angle < 1e-10
      ? [1, 0, 0, 0]
      : [
          Math.cos(angle / 2),
          axis[0] * Math.sin(angle / 2),
          axis[1] * Math.sin(angle / 2),
          axis[2] * Math.sin(angle / 2),
        ];
  const yaw: Quaternion = [
    Math.cos(yawRadians / 2),
    normal[0] * Math.sin(yawRadians / 2),
    normal[1] * Math.sin(yawRadians / 2),
    normal[2] * Math.sin(yawRadians / 2),
  ];
  const [w, x, y, z] = multiplyQuaternion(yaw, tilt);
  const pitchValue = Math.max(-1, Math.min(1, 2 * (w * y - z * x)));
  return [
    Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y)),
    Math.asin(pitchValue),
    Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)),
  ];
}
