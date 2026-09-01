import type { GeometryAsset, Vec3 } from './model.js';

export interface JointDelta {
  translation?: Vec3;
  rotation?: Vec3;
}

type Matrix3 = [Vec3, Vec3, Vec3];
export interface WorldJoint {
  position: Vec3;
  rotation: Matrix3;
}

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
function multiplyVector(matrix: Matrix3, vector: Vec3): Vec3 {
  return [
    matrix[0][0] * vector[0] + matrix[0][1] * vector[1] + matrix[0][2] * vector[2],
    matrix[1][0] * vector[0] + matrix[1][1] * vector[1] + matrix[1][2] * vector[2],
    matrix[2][0] * vector[0] + matrix[2][1] * vector[1] + matrix[2][2] * vector[2],
  ];
}

function transpose(matrix: Matrix3): Matrix3 {
  return [
    [matrix[0][0], matrix[1][0], matrix[2][0]],
    [matrix[0][1], matrix[1][1], matrix[2][1]],
    [matrix[0][2], matrix[1][2], matrix[2][2]],
  ];
}

function multiply(a: Matrix3, b: Matrix3): Matrix3 {
  return [0, 1, 2].map((row) =>
    [0, 1, 2].map(
      (column) =>
        a[row]![0] * b[0][column]! + a[row]![1] * b[1][column]! + a[row]![2] * b[2][column]!,
    ),
  ) as Matrix3;
}

function eulerMatrix([x, y, z]: Vec3): Matrix3 {
  const cx = Math.cos(x);
  const sx = Math.sin(x);
  const cy = Math.cos(y);
  const sy = Math.sin(y);
  const cz = Math.cos(z);
  const sz = Math.sin(z);
  return [
    [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx],
    [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx],
    [-sy, cy * sx, cy * cx],
  ];
}

export function jointWorldTransforms(asset: GeometryAsset, pose: Record<string, JointDelta> = {}) {
  const worlds = new Map<string, WorldJoint>();
  for (const joint of asset.skeleton) {
    const parent = joint.parent ? worlds.get(joint.parent) : undefined;
    const delta = pose[joint.id];
    const localPosition = add(joint.restPosition, delta?.translation ?? [0, 0, 0]);
    const localRotation = eulerMatrix(delta?.rotation ?? [0, 0, 0]);
    worlds.set(
      joint.id,
      parent
        ? {
            position: add(parent.position, multiplyVector(parent.rotation, localPosition)),
            rotation: multiply(parent.rotation, localRotation),
          }
        : { position: localPosition, rotation: localRotation },
    );
  }
  return worlds;
}

export function animatedAttachmentPosition(
  asset: GeometryAsset,
  attachmentId: string,
  pose: Record<string, JointDelta> = {},
) {
  const attachment = asset.attachments[attachmentId];
  if (!attachment) throw new Error(`Geometry '${asset.id}' has no attachment '${attachmentId}'`);
  if (!attachment.bone) return attachment.position;
  const rest = jointWorldTransforms(asset);
  const animated = jointWorldTransforms(asset, pose);
  const restBone = rest.get(attachment.bone);
  const animatedBone = animated.get(attachment.bone);
  if (!restBone || !animatedBone)
    throw new Error(`Attachment '${attachmentId}' references absent bone '${attachment.bone}'`);
  const localOffset = subtract(attachment.position, restBone.position);
  return add(animatedBone.position, multiplyVector(animatedBone.rotation, localOffset));
}

/**
 * Applies the geometry contract's bind pose and linear-blend skinning without a renderer.
 * The skeleton stores local rest translations; its bind rotations are identity unless a
 * parent pose rotates them, so the inverse bind transform is the transpose of the
 * orthonormal rest rotation plus the inverse rest translation.
 */
export function deformSkinnedPositions(
  asset: GeometryAsset,
  pose: Record<string, JointDelta> = {},
  positions: Vec3[] = asset.positions,
): Vec3[] {
  if (!asset.skinIndices || !asset.skinWeights) return positions.map((value) => [...value]);
  const rest = jointWorldTransforms(asset);
  const animated = jointWorldTransforms(asset, pose);
  return positions.map((position, vertex) => {
    let output: Vec3 = [0, 0, 0];
    for (let influence = 0; influence < 4; influence++) {
      const weight = asset.skinWeights![vertex]![influence]!;
      if (weight <= 0) continue;
      const joint = asset.skeleton[asset.skinIndices![vertex]![influence]!];
      if (!joint) throw new Error(`Vertex ${vertex} references an absent skin joint`);
      const restJoint = rest.get(joint.id)!;
      const animatedJoint = animated.get(joint.id)!;
      const bindLocal = multiplyVector(
        transpose(restJoint.rotation),
        subtract(position, restJoint.position),
      );
      const deformed = add(
        animatedJoint.position,
        multiplyVector(animatedJoint.rotation, bindLocal),
      );
      output = add(output, [deformed[0] * weight, deformed[1] * weight, deformed[2] * weight]);
    }
    return output;
  });
}

type Quaternion = [number, number, number, number];
const quaternionDot = (a: Quaternion, b: Quaternion) =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
const quaternionScale = (value: Quaternion, amount: number): Quaternion => [
  value[0] * amount,
  value[1] * amount,
  value[2] * amount,
  value[3] * amount,
];
const quaternionAdd = (a: Quaternion, b: Quaternion): Quaternion => [
  a[0] + b[0],
  a[1] + b[1],
  a[2] + b[2],
  a[3] + b[3],
];
const quaternionConjugate = (value: Quaternion): Quaternion => [
  -value[0],
  -value[1],
  -value[2],
  value[3],
];
const quaternionMultiply = (a: Quaternion, b: Quaternion): Quaternion => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];

function matrixQuaternion(matrix: Matrix3): Quaternion {
  const trace = matrix[0][0] + matrix[1][1] + matrix[2][2];
  let quaternion: Quaternion;
  if (trace > 0) {
    const scale = Math.sqrt(trace + 1) * 2;
    quaternion = [
      (matrix[2][1] - matrix[1][2]) / scale,
      (matrix[0][2] - matrix[2][0]) / scale,
      (matrix[1][0] - matrix[0][1]) / scale,
      scale * 0.25,
    ];
  } else if (matrix[0][0] > matrix[1][1] && matrix[0][0] > matrix[2][2]) {
    const scale = Math.sqrt(1 + matrix[0][0] - matrix[1][1] - matrix[2][2]) * 2;
    quaternion = [
      scale * 0.25,
      (matrix[0][1] + matrix[1][0]) / scale,
      (matrix[0][2] + matrix[2][0]) / scale,
      (matrix[2][1] - matrix[1][2]) / scale,
    ];
  } else if (matrix[1][1] > matrix[2][2]) {
    const scale = Math.sqrt(1 + matrix[1][1] - matrix[0][0] - matrix[2][2]) * 2;
    quaternion = [
      (matrix[0][1] + matrix[1][0]) / scale,
      scale * 0.25,
      (matrix[1][2] + matrix[2][1]) / scale,
      (matrix[0][2] - matrix[2][0]) / scale,
    ];
  } else {
    const scale = Math.sqrt(1 + matrix[2][2] - matrix[0][0] - matrix[1][1]) * 2;
    quaternion = [
      (matrix[0][2] + matrix[2][0]) / scale,
      (matrix[1][2] + matrix[2][1]) / scale,
      scale * 0.25,
      (matrix[1][0] - matrix[0][1]) / scale,
    ];
  }
  const length = Math.hypot(...quaternion);
  return quaternionScale(quaternion, 1 / length);
}

function rotateByQuaternion(position: Vec3, rotation: Quaternion): Vec3 {
  const transformed = quaternionMultiply(
    quaternionMultiply(rotation, [position[0], position[1], position[2], 0]),
    quaternionConjugate(rotation),
  );
  return [transformed[0], transformed[1], transformed[2]];
}

function dualQuaternionTransforms(asset: GeometryAsset, pose: Record<string, JointDelta>) {
  const rest = jointWorldTransforms(asset);
  const animated = jointWorldTransforms(asset, pose);
  return asset.skeleton.map((joint) => {
    const restJoint = rest.get(joint.id)!;
    const animatedJoint = animated.get(joint.id)!;
    const rotationMatrix = multiply(animatedJoint.rotation, transpose(restJoint.rotation));
    const rotation = matrixQuaternion(rotationMatrix);
    const translation = subtract(
      animatedJoint.position,
      multiplyVector(rotationMatrix, restJoint.position),
    );
    const dual = quaternionScale(
      quaternionMultiply([translation[0], translation[1], translation[2], 0], rotation),
      0.5,
    );
    return { rotation, dual };
  });
}

function blendedDualQuaternion(
  asset: GeometryAsset,
  transforms: ReturnType<typeof dualQuaternionTransforms>,
  vertex: number,
) {
  let real: Quaternion = [0, 0, 0, 0];
  let dual: Quaternion = [0, 0, 0, 0];
  let reference: Quaternion | undefined;
  for (let influence = 0; influence < 4; influence++) {
    const weight = asset.skinWeights![vertex]![influence]!;
    if (weight <= 0) continue;
    const transform = transforms[asset.skinIndices![vertex]![influence]!];
    if (!transform) throw new Error(`Vertex ${vertex} references an absent skin joint`);
    reference ??= transform.rotation;
    const sign = quaternionDot(reference, transform.rotation) < 0 ? -1 : 1;
    real = quaternionAdd(real, quaternionScale(transform.rotation, weight * sign));
    dual = quaternionAdd(dual, quaternionScale(transform.dual, weight * sign));
  }
  const length = Math.hypot(...real);
  if (length <= 1e-12) return undefined;
  real = quaternionScale(real, 1 / length);
  dual = quaternionScale(dual, 1 / length);
  dual = quaternionAdd(dual, quaternionScale(real, -quaternionDot(real, dual)));
  return { real, dual };
}

/**
 * Preserve-volume dual-quaternion skinning for production-human assets. This
 * is the renderer-independent equivalent of Blender's armature preserve-volume
 * mode and avoids the joint collapse inherent to matrix-weighted LBS.
 */
export function deformSkinnedPositionsDualQuaternion(
  asset: GeometryAsset,
  pose: Record<string, JointDelta> = {},
  positions: Vec3[] = asset.positions,
): Vec3[] {
  if (!asset.skinIndices || !asset.skinWeights) return positions.map((value) => [...value]);
  const transforms = dualQuaternionTransforms(asset, pose);
  return positions.map((position, vertex) =>
    deformSkinnedVertexDualQuaternion(asset, transforms, position, vertex),
  );
}

function deformSkinnedVertexDualQuaternion(
  asset: GeometryAsset,
  transforms: ReturnType<typeof dualQuaternionTransforms>,
  position: Vec3,
  vertex: number,
): Vec3 {
  const blended = blendedDualQuaternion(asset, transforms, vertex);
  if (!blended) return [...position];
  const { real, dual } = blended;
  const translationQuaternion = quaternionScale(
    quaternionMultiply(dual, quaternionConjugate(real)),
    2,
  );
  const rotated = rotateByQuaternion(position, real);
  return [
    rotated[0] + translationQuaternion[0],
    rotated[1] + translationQuaternion[1],
    rotated[2] + translationQuaternion[2],
  ];
}

/**
 * Deforms selected original vertex indices without evaluating an entire mesh.
 * Contact IK and other geometry-aware constraints use this path so they can
 * solve against the rendered surface rather than a nominal bone endpoint.
 */
export function deformSkinnedVerticesDualQuaternion(
  asset: GeometryAsset,
  pose: Record<string, JointDelta> = {},
  vertices: readonly number[],
): Vec3[] {
  if (!asset.skinIndices || !asset.skinWeights)
    return vertices.map((vertex) => [...asset.positions[vertex]!] as Vec3);
  const transforms = dualQuaternionTransforms(asset, pose);
  return vertices.map((vertex) => {
    const position = asset.positions[vertex];
    if (!position) throw new Error(`Cannot deform absent vertex ${vertex}`);
    return deformSkinnedVertexDualQuaternion(asset, transforms, position, vertex) as Vec3;
  });
}

/** Applies renderer-independent scalar morph samples to bind-pose positions. */
export function applySampledMorphTargets(
  asset: GeometryAsset,
  sampled: Record<string, number | Vec3>,
): Vec3[] {
  const positions = asset.positions.map((position) => [...position] as Vec3);
  for (const target of asset.morphTargets) {
    const weight = Number(sampled[`morph:${target.id}`] ?? 0);
    if (weight === 0) continue;
    target.vertexIndices.forEach((vertex, index) => {
      const delta = target.positionDeltas[index]!;
      positions[vertex] = [
        positions[vertex]![0] + delta[0] * weight,
        positions[vertex]![1] + delta[1] * weight,
        positions[vertex]![2] + delta[2] * weight,
      ];
    });
  }
  return positions;
}

/** Converts the shared motion sample vocabulary into skeleton pose deltas. */
export function poseFromMotionSample(sampled: Record<string, number | Vec3>) {
  const pose: Record<string, JointDelta> = {};
  for (const [key, value] of Object.entries(sampled)) {
    if (key.startsWith('morph:')) continue;
    const separator = key.lastIndexOf(':');
    const joint = key.slice(0, separator);
    const property = key.slice(separator + 1);
    const target = (pose[joint] ??= {});
    if (property === 'translation') target.translation = value as Vec3;
    else if (property === 'rotation-euler') target.rotation = value as Vec3;
  }
  return pose;
}

/** Evaluates morphing and linear-blend skinning in the same order as production renderers. */
export function deformGeometryAtMotionSample(
  asset: GeometryAsset,
  sampled: Record<string, number | Vec3>,
) {
  return deformSkinnedPositions(
    asset,
    poseFromMotionSample(sampled),
    applySampledMorphTargets(asset, sampled),
  );
}

function inverse(matrix: Matrix3): Matrix3 {
  const [a, b, c] = matrix[0];
  const [d, e, f] = matrix[1];
  const [g, h, i] = matrix[2];
  const determinant = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(determinant) < 1e-10) throw new Error('Skinning transform is not invertible');
  const scale = 1 / determinant;
  return [
    [(e * i - f * h) * scale, (c * h - b * i) * scale, (b * f - c * e) * scale],
    [(f * g - d * i) * scale, (a * i - c * g) * scale, (c * d - a * f) * scale],
    [(d * h - e * g) * scale, (b * g - a * h) * scale, (a * e - b * d) * scale],
  ];
}

/** Converts a desired posed-space displacement into the corresponding bind-space morph delta. */
export function bindDeltaForWorldDisplacement(
  asset: GeometryAsset,
  vertex: number,
  pose: Record<string, JointDelta>,
  worldDelta: Vec3,
): Vec3 {
  if (!asset.skinIndices || !asset.skinWeights)
    throw new Error('Bind-space correction requires skinned geometry');
  const rest = jointWorldTransforms(asset);
  const animated = jointWorldTransforms(asset, pose);
  const blended: Matrix3 = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let influence = 0; influence < 4; influence++) {
    const weight = asset.skinWeights[vertex]![influence]!;
    if (weight <= 0) continue;
    const joint = asset.skeleton[asset.skinIndices[vertex]![influence]!]!;
    const mapping = multiply(
      animated.get(joint.id)!.rotation,
      transpose(rest.get(joint.id)!.rotation),
    );
    for (let row = 0; row < 3; row++)
      for (let column = 0; column < 3; column++)
        blended[row]![column]! += mapping[row]![column]! * weight;
  }
  return multiplyVector(inverse(blended), worldDelta);
}
