import type { GeometryAsset, Vec3 } from '../geometry/model.js';
import type { SceneTransform } from './model.js';

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

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

function inverseRotateEuler([x, y, z]: Vec3, [rx, ry, rz]: Vec3): Vec3 {
  const cz = Math.cos(-rz);
  const sz = Math.sin(-rz);
  const afterZ: Vec3 = [x * cz - y * sz, x * sz + y * cz, z];
  const cy = Math.cos(-ry);
  const sy = Math.sin(-ry);
  const afterY: Vec3 = [
    afterZ[0] * cy + afterZ[2] * sy,
    afterZ[1],
    -afterZ[0] * sy + afterZ[2] * cy,
  ];
  const cx = Math.cos(-rx);
  const sx = Math.sin(-rx);
  return [afterY[0], afterY[1] * cx - afterY[2] * sx, afterY[1] * sx + afterY[2] * cx];
}

export function transformPoint(point: Vec3, transform: SceneTransform): Vec3 {
  const scaled: Vec3 = [
    point[0] * transform.scale[0],
    point[1] * transform.scale[1],
    point[2] * transform.scale[2],
  ];
  return add(transform.position, rotateEuler(scaled, transform.rotation));
}

export function inverseTransformPoint(point: Vec3, transform: SceneTransform): Vec3 {
  const translated: Vec3 = [
    point[0] - transform.position[0],
    point[1] - transform.position[1],
    point[2] - transform.position[2],
  ];
  const rotated = inverseRotateEuler(translated, transform.rotation);
  return [
    rotated[0] / transform.scale[0],
    rotated[1] / transform.scale[1],
    rotated[2] / transform.scale[2],
  ];
}

export function resolveAttachment(
  asset: GeometryAsset,
  attachmentId: string,
  transform: SceneTransform,
) {
  const attachment = asset.attachments[attachmentId];
  if (!attachment) throw new Error(`Geometry '${asset.id}' has no attachment '${attachmentId}'`);
  return {
    ...attachment,
    position: transformPoint(attachment.position, transform),
    rotation: [
      attachment.rotation[0] + transform.rotation[0],
      attachment.rotation[1] + transform.rotation[1],
      attachment.rotation[2] + transform.rotation[2],
    ] as Vec3,
  };
}
