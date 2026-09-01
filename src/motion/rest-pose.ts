import type { SkeletonJoint, Vec3 } from '../geometry/model.js';
import { createQuinticMotionKeyframes, motionClipSchema, type MotionClip } from './model.js';

type Matrix3 = [Vec3, Vec3, Vec3];

export const productionAPoseArmRetargetJoints = [
  'left-upper-arm',
  'right-upper-arm',
  'left-forearm',
  'right-forearm',
] as const;

export interface RestPoseRetargetOptions {
  jointIds?: readonly string[];
}

const identityMatrix = (): Matrix3 => [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const normalize = (value: Vec3): Vec3 => {
  const length = Math.hypot(...value);
  if (length <= 1e-12) throw new Error('Rest-pose retargeting requires non-zero bone vectors');
  return [value[0] / length, value[1] / length, value[2] / length];
};
const multiply = (left: Matrix3, right: Matrix3): Matrix3 =>
  [0, 1, 2].map((row) =>
    [0, 1, 2].map(
      (column) =>
        left[row]![0] * right[0][column]! +
        left[row]![1] * right[1][column]! +
        left[row]![2] * right[2][column]!,
    ),
  ) as Matrix3;
const transpose = (matrix: Matrix3): Matrix3 => [
  [matrix[0][0], matrix[1][0], matrix[2][0]],
  [matrix[0][1], matrix[1][1], matrix[2][1]],
  [matrix[0][2], matrix[1][2], matrix[2][2]],
];

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

function matrixEuler(matrix: Matrix3): Vec3 {
  const y = Math.asin(Math.max(-1, Math.min(1, -matrix[2][0])));
  const cosine = Math.cos(y);
  if (Math.abs(cosine) > 1e-7)
    return [Math.atan2(matrix[2][1], matrix[2][2]), y, Math.atan2(matrix[1][0], matrix[0][0])];
  return [Math.atan2(-matrix[1][2], matrix[1][1]), y, 0];
}

function rotationBetween(fromInput: Vec3, toInput: Vec3): Matrix3 {
  const from = normalize(fromInput);
  const to = normalize(toInput);
  const cosine = Math.max(-1, Math.min(1, dot(from, to)));
  if (cosine > 1 - 1e-10)
    return [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
  let axis = cross(from, to);
  if (cosine < -1 + 1e-10) {
    axis = normalize(Math.abs(from[0]) < 0.8 ? cross(from, [1, 0, 0]) : cross(from, [0, 1, 0]));
  } else axis = normalize(axis);
  const sine = Math.sqrt(Math.max(0, 1 - cosine * cosine));
  const [x, y, z] = axis;
  const oneMinus = 1 - cosine;
  return [
    [cosine + x * x * oneMinus, x * y * oneMinus - z * sine, x * z * oneMinus + y * sine],
    [y * x * oneMinus + z * sine, cosine + y * y * oneMinus, y * z * oneMinus - x * sine],
    [z * x * oneMinus - y * sine, z * y * oneMinus + x * sine, cosine + z * z * oneMinus],
  ];
}

function primaryChild(joint: string, skeleton: SkeletonJoint[]) {
  const children = skeleton.filter((candidate) => candidate.parent === joint);
  const priority: Record<string, string> = {
    hips: 'spine',
    spine: 'chest',
    chest: 'neck',
    neck: 'head',
    'left-clavicle': 'left-upper-arm',
    'right-clavicle': 'right-upper-arm',
    'left-upper-arm': 'left-forearm',
    'right-upper-arm': 'right-forearm',
    'left-forearm': 'left-hand',
    'right-forearm': 'right-hand',
    'left-thigh': 'left-shin',
    'right-thigh': 'right-shin',
    'left-shin': 'left-foot',
    'right-shin': 'right-foot',
    'left-foot': 'left-toe',
    'right-foot': 'right-toe',
  };
  return (
    children.find((child) => child.id === priority[joint]) ??
    (children.length === 1 ? children[0] : undefined)
  );
}

function matchingSkeletons(source: SkeletonJoint[], target: SkeletonJoint[]) {
  const sourceIds = source.map((joint) => joint.id);
  const targetIds = target.map((joint) => joint.id);
  if (JSON.stringify(sourceIds) !== JSON.stringify(targetIds))
    throw new Error('Rest-pose retargeting requires identical ordered joint IDs');
  for (let index = 0; index < source.length; index++)
    if (source[index]!.parent !== target[index]!.parent)
      throw new Error(
        `Rest-pose retargeting requires matching hierarchy at '${source[index]!.id}'`,
      );
}

function unwrap(values: Vec3[]) {
  for (let index = 1; index < values.length; index++)
    for (let axis = 0; axis < 3; axis++) {
      let value = values[index]![axis]!;
      const previous = values[index - 1]![axis]!;
      while (value - previous > Math.PI) value -= Math.PI * 2;
      while (value - previous < -Math.PI) value += Math.PI * 2;
      values[index]![axis] = value;
    }
  return values;
}

function isIdentity(matrix: Matrix3, tolerance = 1e-9) {
  const identity = identityMatrix();
  return matrix.every((row, rowIndex) =>
    row.every(
      (value, columnIndex) => Math.abs(value - identity[rowIndex]![columnIndex]!) <= tolerance,
    ),
  );
}

/**
 * Retargets rotation deltas between compatible skeletons whose bind directions
 * differ (for example T-pose to A-pose). The authored world-relative child
 * direction is preserved without baking target-specific offsets into the source
 * motion or mutating canonical joint IDs.
 */
export function retargetMotionRestPose(
  clipInput: MotionClip,
  source: SkeletonJoint[],
  target: SkeletonJoint[],
  id = `${clipInput.id}.rest-retargeted`,
  options: RestPoseRetargetOptions = {},
) {
  const clip = motionClipSchema.parse(clipInput);
  matchingSkeletons(source, target);
  const sourceById = new Map(source.map((joint) => [joint.id, joint]));
  const targetById = new Map(target.map((joint) => [joint.id, joint]));
  const selected = options.jointIds ? new Set(options.jointIds) : undefined;
  if (selected)
    for (const joint of selected)
      if (!sourceById.has(joint))
        throw new Error(`Rest-pose retarget profile references absent joint '${joint}'`);
  const corrections = new Map<string, Matrix3>();
  for (const joint of source) {
    if (selected && !selected.has(joint.id)) continue;
    const sourceChild = primaryChild(joint.id, source);
    const targetChild = primaryChild(joint.id, target);
    if (!sourceChild || !targetChild || sourceChild.id !== targetChild.id) continue;
    const correction = rotationBetween(
      targetById.get(targetChild.id)!.restPosition,
      sourceById.get(sourceChild.id)!.restPosition,
    );
    corrections.set(joint.id, correction);
  }
  const correctionFor = (joint: string | undefined) =>
    joint ? (corrections.get(joint) ?? identityMatrix()) : identityMatrix();
  const correctedJoints = new Set<string>();
  const tracks = clip.tracks.map((track) => {
    if (track.property !== 'rotation-euler') return structuredClone(track);
    const joint = sourceById.get(track.joint)!;
    const parentInverse = transpose(correctionFor(joint.parent));
    const childCorrection = correctionFor(joint.id);
    if (isIdentity(parentInverse) && isIdentity(childCorrection)) return structuredClone(track);
    correctedJoints.add(track.joint);
    const values = unwrap(
      track.keyframes.map((keyframe) =>
        matrixEuler(
          multiply(multiply(parentInverse, eulerMatrix(keyframe.value)), childCorrection),
        ),
      ),
    );
    if (track.interpolation === 'quintic-hermite') {
      const interval = clip.durationSeconds / (track.keyframes.length - 1);
      if (
        track.keyframes.some((keyframe, index) => Math.abs(keyframe.time - index * interval) > 1e-8)
      )
        throw new Error(
          `Rest-pose retargeting requires uniform quintic samples for '${track.joint}'`,
        );
      return {
        ...track,
        keyframes: createQuinticMotionKeyframes(values, clip.durationSeconds, clip.loop),
      };
    }
    return {
      ...track,
      keyframes: track.keyframes.map((keyframe, index) => ({ ...keyframe, value: values[index]! })),
    };
  });
  const animatedRotationJoints = new Set(
    clip.tracks.filter((track) => track.property === 'rotation-euler').map((track) => track.joint),
  );
  // A source clip is allowed to omit identity channels. Those joints still
  // need a constant bind correction: otherwise an A-pose upper arm may be
  // corrected at the clavicle while its untracked forearm remains in the
  // target bind direction, bending the entire chain across the torso.
  for (const joint of target) {
    // A scoped production profile deliberately preserves all non-selected
    // descendant rest orientations. In particular, an arm A-pose conversion
    // must not inject a large wrist counter-rotation merely to reproduce the
    // proxy hand's world axes.
    if (selected && !selected.has(joint.id)) continue;
    if (animatedRotationJoints.has(joint.id)) continue;
    const correction = multiply(transpose(correctionFor(joint.parent)), correctionFor(joint.id));
    if (isIdentity(correction)) continue;
    correctedJoints.add(joint.id);
    const value = matrixEuler(correction);
    tracks.push({
      joint: joint.id,
      property: 'rotation-euler',
      space: 'local-delta',
      interpolation: 'linear',
      keyframes: [
        { time: 0, value, easing: 'linear' },
        { time: clip.durationSeconds, value: [...value] as Vec3, easing: 'linear' },
      ],
    });
  }
  return motionClipSchema.parse({
    ...clip,
    id,
    tracks,
    metadata: {
      ...clip.metadata,
      restPoseRetargeting: {
        generator: 'videoer.rest-pose-retarget.v1',
        sourceJointCount: source.length,
        targetJointCount: target.length,
        correctedJoints: [...correctedJoints].sort(),
      },
    },
  });
}
