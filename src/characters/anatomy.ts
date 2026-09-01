import type { GeometryAsset, Vec3 } from '../geometry/model.js';
import {
  deformSkinnedPositions,
  deformSkinnedPositionsDualQuaternion,
  type JointDelta,
} from '../geometry/kinematics.js';

const requiredJoints = [
  'root',
  'hips',
  'spine',
  'chest',
  'neck',
  'head',
  'left-clavicle',
  'left-upper-arm',
  'left-forearm',
  'left-hand',
  'right-clavicle',
  'right-upper-arm',
  'right-forearm',
  'right-hand',
  'left-thigh',
  'left-shin',
  'left-foot',
  'left-toe',
  'right-thigh',
  'right-shin',
  'right-foot',
  'right-toe',
] as const;

const requiredAttachments = [
  'gaze',
  'left-hand-grip',
  'right-hand-grip',
  'left-heel-contact',
  'right-heel-contact',
  'left-toe-contact',
  'right-toe-contact',
] as const;

const deformationPairs = [
  ['hips', 'spine'],
  ['spine', 'chest'],
  ['chest', 'neck'],
  ['chest', 'left-clavicle'],
  ['left-clavicle', 'left-upper-arm'],
  ['left-upper-arm', 'left-forearm'],
  ['left-forearm', 'left-hand'],
  ['chest', 'right-clavicle'],
  ['right-clavicle', 'right-upper-arm'],
  ['right-upper-arm', 'right-forearm'],
  ['right-forearm', 'right-hand'],
  ['hips', 'left-thigh'],
  ['left-thigh', 'left-shin'],
  ['left-shin', 'left-foot'],
  ['left-foot', 'left-toe'],
  ['hips', 'right-thigh'],
  ['right-thigh', 'right-shin'],
  ['right-shin', 'right-foot'],
  ['right-foot', 'right-toe'],
] as const;

const requiredOwnedBones = [
  'head',
  'left-hand',
  'right-hand',
  'left-foot',
  'right-foot',
  'left-toe',
  'right-toe',
] as const;

export const productionHumanAnatomyPolicy = {
  id: 'videoer.production-human-anatomy.v1',
  maximumBodyComponents: 1,
  maximumBoundaryEdges: 0,
  maximumNonManifoldEdges: 0,
  maximumOrientationConflicts: 0,
  minimumJointBlendVertices: 4,
  minimumOwnedVertices: 8,
  minimumSecondaryInfluence: 0.05,
  minimumOwnedInfluence: 0.5,
  minimumPoseAreaRatio: 0.15,
  maximumPoseAreaRatio: 3.5,
  maximumPoseAreaOutlierRatio: 0.01,
} as const;

interface Triangle {
  a: number;
  b: number;
  c: number;
}

function selectedTriangles(asset: GeometryAsset, bodyMaterialIds: string[]): Triangle[] {
  const ranges = asset.materialGroups.length
    ? asset.materialGroups
        .filter((group) => bodyMaterialIds.includes(group.materialId))
        .map((group) => [group.start, group.start + group.count] as const)
    : [[0, asset.indices.length] as const];
  const triangles: Triangle[] = [];
  for (const [start, end] of ranges)
    for (let index = start; index < end; index += 3) {
      const a = asset.indices[index];
      const b = asset.indices[index + 1];
      const c = asset.indices[index + 2];
      if (a !== undefined && b !== undefined && c !== undefined) triangles.push({ a, b, c });
    }
  return triangles;
}

function topologyStats(triangles: Triangle[]) {
  const parents = new Map<number, number>();
  const find = (value: number): number => {
    const parent = parents.get(value);
    if (parent === undefined) {
      parents.set(value, value);
      return value;
    }
    if (parent === value) return value;
    const root = find(parent);
    parents.set(value, root);
    return root;
  };
  const union = (left: number, right: number) => {
    const a = find(left);
    const b = find(right);
    if (a !== b) parents.set(b, a);
  };
  const edges = new Map<string, number>();
  const directions = new Map<string, number>();
  for (const triangle of triangles) {
    union(triangle.a, triangle.b);
    union(triangle.b, triangle.c);
    for (const [left, right] of [
      [triangle.a, triangle.b],
      [triangle.b, triangle.c],
      [triangle.c, triangle.a],
    ] as Array<[number, number]>) {
      const key = left < right ? `${left}:${right}` : `${right}:${left}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
      directions.set(key, (directions.get(key) ?? 0) + (left < right ? 1 : -1));
    }
  }
  return {
    connectedComponents: new Set([...parents.keys()].map(find)).size,
    boundaryEdges: [...edges.values()].filter((count) => count === 1).length,
    nonManifoldEdges: [...edges.values()].filter((count) => count > 2).length,
    orientationConflicts: [...directions.values()].filter((balance) => balance !== 0).length,
  };
}

function vertexBoneWeights(asset: GeometryAsset, vertex: number) {
  const result = new Map<string, number>();
  const indices = asset.skinIndices?.[vertex];
  const weights = asset.skinWeights?.[vertex];
  if (!indices || !weights) return result;
  for (let influence = 0; influence < 4; influence++) {
    const joint = asset.skeleton[indices[influence]!];
    if (joint) result.set(joint.id, (result.get(joint.id) ?? 0) + weights[influence]!);
  }
  return result;
}

const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const triangleArea = (positions: Vec3[], triangle: Triangle) => {
  const a = positions[triangle.a]!;
  const b = positions[triangle.b]!;
  const c = positions[triangle.c]!;
  return Math.hypot(...cross(subtract(b, a), subtract(c, a))) * 0.5;
};

function poseAreaRange(
  asset: GeometryAsset,
  triangles: Triangle[],
  pose: Record<string, JointDelta>,
) {
  const deformed =
    asset.metadata.skinning === 'deterministic-dual-quaternion-v1'
      ? deformSkinnedPositionsDualQuaternion(asset, pose)
      : deformSkinnedPositions(asset, pose);
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = 0;
  const ratios: number[] = [];
  for (const triangle of triangles) {
    const restArea = triangleArea(asset.positions, triangle);
    if (restArea <= 1e-10) continue;
    const ratio = triangleArea(deformed, triangle) / restArea;
    ratios.push(ratio);
    minimum = Math.min(minimum, ratio);
    maximum = Math.max(maximum, ratio);
  }
  ratios.sort((a, b) => a - b);
  const percentile = (amount: number) =>
    ratios[Math.min(ratios.length - 1, Math.max(0, Math.round((ratios.length - 1) * amount)))] ?? 0;
  const outliers = ratios.filter(
    (ratio) =>
      ratio < productionHumanAnatomyPolicy.minimumPoseAreaRatio ||
      ratio > productionHumanAnatomyPolicy.maximumPoseAreaRatio,
  ).length;
  return {
    minimum: Number.isFinite(minimum) ? minimum : 0,
    maximum,
    p01: percentile(0.01),
    p99: percentile(0.99),
    outlierRatio: ratios.length ? outliers / ratios.length : 1,
  };
}

const deformationPoses: Record<string, Record<string, JointDelta>> = {
  'arms-raised': {
    'left-clavicle': { rotation: [0, 0, Math.PI * 0.48] },
    'right-clavicle': { rotation: [0, 0, -Math.PI * 0.48] },
  },
  'elbows-bent': {
    'left-forearm': { rotation: [0, -Math.PI * 0.62, 0] },
    'right-forearm': { rotation: [0, Math.PI * 0.62, 0] },
  },
  'knees-bent': {
    'left-thigh': { rotation: [-Math.PI * 0.28, 0, 0] },
    'left-shin': { rotation: [Math.PI * 0.58, 0, 0] },
    'right-thigh': { rotation: [-Math.PI * 0.28, 0, 0] },
    'right-shin': { rotation: [Math.PI * 0.58, 0, 0] },
  },
};

export function verifyProductionHumanAnatomy(asset: GeometryAsset) {
  const declared = asset.metadata.anatomy;
  const declaredBodyMaterials =
    declared &&
    typeof declared === 'object' &&
    'bodyMaterialIds' in declared &&
    Array.isArray(declared.bodyMaterialIds)
      ? declared.bodyMaterialIds.filter((value): value is string => typeof value === 'string')
      : undefined;
  const bodyMaterialIds =
    declaredBodyMaterials ??
    (asset.materials.some((material) => material.id === 'skin')
      ? ['skin']
      : asset.materials.map((material) => material.id));
  const triangles = selectedTriangles(asset, bodyMaterialIds);
  const selectedVertices = new Set(triangles.flatMap(({ a, b, c }) => [a, b, c]));
  const topology = topologyStats(triangles);
  const weights = new Map(
    [...selectedVertices].map((vertex) => [vertex, vertexBoneWeights(asset, vertex)]),
  );
  const jointBlendVertices = Object.fromEntries(
    deformationPairs.map(([parent, child]) => [
      `${parent}:${child}`,
      [...weights.values()].filter(
        (value) =>
          (value.get(parent) ?? 0) >= productionHumanAnatomyPolicy.minimumSecondaryInfluence &&
          (value.get(child) ?? 0) >= productionHumanAnatomyPolicy.minimumSecondaryInfluence,
      ).length,
    ]),
  );
  const ownedVertices = Object.fromEntries(
    requiredOwnedBones.map((bone) => [
      bone,
      [...weights.values()].filter(
        (value) => (value.get(bone) ?? 0) >= productionHumanAnatomyPolicy.minimumOwnedInfluence,
      ).length,
    ]),
  );
  const poseAreaRatios = Object.fromEntries(
    Object.entries(deformationPoses).map(([id, pose]) => [
      id,
      poseAreaRange(asset, triangles, pose),
    ]),
  );
  const jointIds = new Set(asset.skeleton.map((joint) => joint.id));
  const issues: string[] = [];
  if (!triangles.length) issues.push('character.body-surface-missing');
  if (topology.connectedComponents > productionHumanAnatomyPolicy.maximumBodyComponents)
    issues.push('character.body-surface-disconnected');
  if (topology.boundaryEdges > productionHumanAnatomyPolicy.maximumBoundaryEdges)
    issues.push('character.body-surface-open-boundary');
  if (topology.nonManifoldEdges > productionHumanAnatomyPolicy.maximumNonManifoldEdges)
    issues.push('character.body-surface-non-manifold');
  if (topology.orientationConflicts > productionHumanAnatomyPolicy.maximumOrientationConflicts)
    issues.push('character.body-surface-inconsistent-winding');
  if (requiredJoints.some((joint) => !jointIds.has(joint)))
    issues.push('character.core-rig-missing');
  if (requiredAttachments.some((attachment) => !asset.attachments[attachment]))
    issues.push('character.anatomical-attachment-missing');
  if (
    Object.values(jointBlendVertices).some(
      (count) => count < productionHumanAnatomyPolicy.minimumJointBlendVertices,
    )
  )
    issues.push('character.joint-deformation-coverage');
  if (
    Object.values(ownedVertices).some(
      (count) => count < productionHumanAnatomyPolicy.minimumOwnedVertices,
    )
  )
    issues.push('character.extremity-geometry-coverage');
  if (
    Object.values(poseAreaRatios).some(
      ({ p01, p99, outlierRatio }) =>
        p01 < productionHumanAnatomyPolicy.minimumPoseAreaRatio ||
        p99 > productionHumanAnatomyPolicy.maximumPoseAreaRatio ||
        outlierRatio > productionHumanAnatomyPolicy.maximumPoseAreaOutlierRatio,
    )
  )
    issues.push('character.pose-deformation-collapse');

  return {
    valid: issues.length === 0,
    policy: productionHumanAnatomyPolicy,
    bodyMaterialIds,
    issues,
    checks: {
      selectedVertices: selectedVertices.size,
      selectedTriangles: triangles.length,
      ...topology,
      jointBlendVertices,
      ownedVertices,
      poseAreaRatios,
    },
  };
}
