import type { CanonicalJointDefinition } from './mannequin.js';
import type { GeometryAsset, SkeletonJoint, Vec3, Vec4 } from '../geometry/model.js';
import { meshSignedDistanceField } from '../geometry/implicit.js';
import { ellipsoidBetween, type MeshPart } from '../geometry/primitives.js';
import { deformSkinnedPositionsDualQuaternion, type JointDelta } from '../geometry/kinematics.js';

const fingerNames = ['thumb', 'index', 'middle', 'ring', 'little'] as const;
const sides = ['left', 'right'] as const;

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, amount: number): Vec3 => [a[0] * amount, a[1] * amount, a[2] * amount];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function capsuleDistance(point: Vec3, start: Vec3, end: Vec3, radius: number) {
  const segment = subtract(end, start);
  const lengthSquared = dot(segment, segment);
  const amount =
    lengthSquared > 1e-12
      ? Math.max(0, Math.min(1, dot(subtract(point, start), segment) / lengthSquared))
      : 0;
  return Math.hypot(...subtract(point, add(start, scale(segment, amount)))) - radius;
}

function ellipsoidDistance(point: Vec3, center: Vec3, radii: Vec3) {
  const local = subtract(point, center);
  return (
    (Math.hypot(local[0] / radii[0], local[1] / radii[1], local[2] / radii[2]) - 1) *
    Math.min(...radii)
  );
}

function smoothUnion(left: number, right: number, radius: number) {
  const amount = Math.max(radius - Math.abs(left - right), 0) / radius;
  return Math.min(left, right) - amount * amount * radius * 0.25;
}

/** Additive extension: the 22 core joint IDs remain unchanged and retargetable. */
export function articulatedHandJointDefinitions(height: number): CanonicalJointDefinition[] {
  const result: CanonicalJointDefinition[] = [];
  const lengths = {
    thumb: [0.022, 0.017, 0.013],
    index: [0.021, 0.015, 0.012],
    middle: [0.023, 0.016, 0.013],
    ring: [0.022, 0.0155, 0.0125],
    little: [0.018, 0.013, 0.0105],
  } as const;
  const baseX = { thumb: 0.028, index: 0.052, middle: 0.055, ring: 0.053, little: 0.05 };
  const baseY = { thumb: -0.03, index: 0.026, middle: 0.009, ring: -0.009, little: -0.026 };
  for (const side of sides) {
    const sign = side === 'left' ? 1 : -1;
    for (const finger of fingerNames) {
      const values = lengths[finger].map((value) => value * height);
      const first: Vec3 =
        finger === 'thumb'
          ? [sign * height * baseX.thumb, height * baseY.thumb, height * -0.008]
          : [sign * height * baseX[finger], baseY[finger] * (height / 1.72), 0];
      result.push({ id: `${side}-${finger}-1`, parent: `${side}-hand`, local: first });
      for (let segment = 1; segment < 3; segment++)
        result.push({
          id: `${side}-${finger}-${segment + 1}`,
          parent: `${side}-${finger}-${segment}`,
          local:
            finger === 'thumb'
              ? [sign * values[segment - 1]!, height * -0.007, height * -0.005]
              : [sign * values[segment - 1]!, 0, 0],
        });
    }
  }
  return result;
}

interface Segment {
  start: Vec3;
  end: Vec3;
  startBone: number;
  endBone: number;
  radius: number;
}

export function createArticulatedHandSurface(
  side: 'left' | 'right',
  height: number,
  skeleton: SkeletonJoint[],
  worlds: Map<string, Vec3>,
): MeshPart {
  const sign = side === 'left' ? 1 : -1;
  const bone = new Map(skeleton.map((joint, index) => [joint.id, index]));
  const hand = worlds.get(`${side}-hand`)!;
  const segments: Segment[] = [];
  const surfaceSegments: Segment[] = [];
  for (const finger of fingerNames) {
    let start = hand;
    let startBone = bone.get(`${side}-hand`)!;
    for (let segment = 1; segment <= 3; segment++) {
      const id = `${side}-${finger}-${segment}`;
      const end = worlds.get(id)!;
      const taper = segment <= 2 ? 1 : 0.78;
      const radius = height * (finger === 'thumb' ? 0.0048 : 0.0042) * taper;
      const value = { start, end, startBone, endBone: bone.get(id)!, radius };
      segments.push(value);
      if (segment > 1) surfaceSegments.push(value);
      start = end;
      startBone = bone.get(id)!;
    }
  }
  const palmCentre = add(hand, [sign * height * 0.03, 0, 0]);
  const palmRadii: Vec3 = [height * 0.028, height * 0.024, height * 0.0125];
  const fingerBases = fingerNames.map((finger) => ({
    position: worlds.get(`${side}-${finger}-1`)! as Vec3,
    bone: bone.get(`${side}-${finger}-1`)! as number,
  }));
  const signedDistance = (position: Vec3) => {
    let distance = ellipsoidDistance(position, palmCentre, palmRadii);
    for (const segment of surfaceSegments) {
      distance = smoothUnion(
        distance,
        capsuleDistance(position, segment.start, segment.end, segment.radius),
        height * 0.003,
      );
      distance = smoothUnion(
        distance,
        ellipsoidDistance(position, segment.start, [
          segment.radius * 1.2,
          segment.radius * 1.08,
          segment.radius * 0.96,
        ]),
        height * 0.0015,
      );
    }
    return distance;
  };
  const skin = (position: Vec3) => {
    let best: Segment | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    let bestAmount = 0;
    for (const segment of segments) {
      const vector = subtract(segment.end, segment.start);
      const lengthSquared = dot(vector, vector);
      const amount =
        lengthSquared > 1e-12
          ? Math.max(0, Math.min(1, dot(subtract(position, segment.start), vector) / lengthSquared))
          : 0;
      const distance = Math.hypot(...subtract(position, add(segment.start, scale(vector, amount))));
      if (distance < bestDistance) {
        bestDistance = distance;
        best = segment;
        bestAmount = amount;
      }
    }
    if (!best)
      return {
        indices: [bone.get(`${side}-hand`)!, 0, 0, 0] as Vec4,
        weights: [1, 0, 0, 0] as Vec4,
      };
    const lateral = sign * (position[0] - hand[0]);
    let base = { ...fingerBases[0]!, distance: Number.POSITIVE_INFINITY };
    for (const candidate of fingerBases) {
      const distance = Math.hypot(
        position[1] - candidate.position[1],
        position[2] - candidate.position[2],
      );
      if (distance < base.distance) base = { ...candidate, distance };
    }
    const baseLateral = sign * (base.position[0] - hand[0]);
    if (base.distance > height * 0.012 || lateral < baseLateral - height * 0.018)
      return {
        indices: [bone.get(`${side}-hand`)!, 0, 0, 0] as Vec4,
        weights: [1, 0, 0, 0] as Vec4,
      };
    if (lateral < baseLateral) {
      const linear = Math.max(
        0,
        Math.min(1, (lateral - (baseLateral - height * 0.018)) / (height * 0.018)),
      );
      const amount = linear * linear * (3 - 2 * linear);
      return {
        indices: [bone.get(`${side}-hand`)!, base.bone, 0, 0] as Vec4,
        weights: [1 - amount, amount, 0, 0] as Vec4,
      };
    }
    const amount = bestAmount * bestAmount * (3 - 2 * bestAmount);
    return {
      indices: [best.startBone, best.endBone, 0, 0] as Vec4,
      weights: [1 - amount, amount, 0, 0] as Vec4,
    };
  };
  const tips = fingerNames.map((finger) => worlds.get(`${side}-${finger}-3`)!);
  const xs = [hand[0] - sign * height * 0.01, ...tips.map((tip) => tip[0])];
  return meshSignedDistanceField({
    minimum: [Math.min(...xs) - height * 0.012, hand[1] - height * 0.055, hand[2] - height * 0.03],
    maximum: [Math.max(...xs) + height * 0.012, hand[1] + height * 0.055, hand[2] + height * 0.03],
    resolution: [64, 56, 36],
    signedDistance,
    skin,
    materialId: 'skin-detail',
    weldScale: 1e5,
    minimumFaceCrossMagnitude: 1e-10,
  });
}

export function createFingernailSurfaces(
  side: 'left' | 'right',
  height: number,
  skeleton: SkeletonJoint[],
  worlds: Map<string, Vec3>,
): MeshPart[] {
  const bone = new Map(skeleton.map((joint, index) => [joint.id, index]));
  return fingerNames.map((finger) => {
    const second = worlds.get(`${side}-${finger}-2`)!;
    const tip = worlds.get(`${side}-${finger}-3`)!;
    const direction = subtract(tip, second);
    const length = Math.hypot(...direction) || 1;
    const unit = scale(direction, 1 / length);
    const nailCentre = add(add(tip, scale(unit, -height * 0.005)), [0, 0, -height * 0.004]);
    const halfLength = height * (finger === 'thumb' ? 0.0052 : 0.0042);
    const nail = ellipsoidBetween(
      add(nailCentre, scale(unit, -halfLength)),
      add(nailCentre, scale(unit, halfLength)),
      height * (finger === 'thumb' ? 0.003 : 0.0026),
      height * 0.00035,
      bone.get(`${side}-${finger}-3`)!,
      bone.get(`${side}-${finger}-3`)!,
      6,
      12,
    );
    nail.materialId = 'nail';
    return nail;
  });
}

export function verifyArticulatedHands(asset: GeometryAsset) {
  const joint = new Map(asset.skeleton.map((value, index) => [value.id, index]));
  const required = sides.flatMap((side) =>
    fingerNames.flatMap((finger) => [1, 2, 3].map((segment) => `${side}-${finger}-${segment}`)),
  );
  const ownedVertices = Object.fromEntries(required.map((id) => [id, 0]));
  const terminalJoints = sides.flatMap((side) =>
    fingerNames.map((finger) => `${side}-${finger}-3`),
  );
  const nailOwnedVertices = Object.fromEntries(terminalJoints.map((id) => [id, 0]));
  const nailVertices = new Set<number>();
  for (const group of asset.materialGroups.filter((value) => value.materialId === 'nail'))
    for (let index = group.start; index < group.start + group.count; index++)
      nailVertices.add(asset.indices[index]!);
  const blendedVertices: Record<string, number> = {};
  const requiredBlendPairs = sides.flatMap((side) =>
    fingerNames.flatMap((finger) => [
      [`${side}-hand`, `${side}-${finger}-1`].sort().join(':'),
      [`${side}-${finger}-1`, `${side}-${finger}-2`].sort().join(':'),
      [`${side}-${finger}-2`, `${side}-${finger}-3`].sort().join(':'),
    ]),
  );
  for (let vertex = 0; vertex < (asset.skinIndices?.length ?? 0); vertex++) {
    const indices = asset.skinIndices![vertex]!;
    const weights = asset.skinWeights![vertex]!;
    for (let influence = 0; influence < 4; influence++) {
      const id = asset.skeleton[indices[influence]!]?.id;
      if (id && id in ownedVertices && weights[influence]! >= 0.5)
        ownedVertices[id] = (ownedVertices[id] ?? 0) + 1;
    }
    const active = indices
      .map((index, influence) => ({ id: asset.skeleton[index]?.id, weight: weights[influence]! }))
      .filter((value) => value.id && value.weight >= 0.05);
    if (active.length >= 2) {
      const key = active
        .map((value) => value.id!)
        .sort()
        .join(':');
      blendedVertices[key] = (blendedVertices[key] ?? 0) + 1;
    }
  }
  for (const vertex of nailVertices) {
    const indices = asset.skinIndices?.[vertex];
    const weights = asset.skinWeights?.[vertex];
    if (!indices || !weights) continue;
    for (let influence = 0; influence < 4; influence++) {
      const id = asset.skeleton[indices[influence]!]?.id;
      if (id && id in nailOwnedVertices && weights[influence]! >= 0.5)
        nailOwnedVertices[id] = (nailOwnedVertices[id] ?? 0) + 1;
    }
  }
  const issues: string[] = [];
  if (required.some((id) => !joint.has(id))) issues.push('character.finger-joints-missing');
  if (Object.values(ownedVertices).some((count) => count < 4))
    issues.push('character.finger-geometry-ownership');
  if (Object.values(nailOwnedVertices).some((count) => count < 8))
    issues.push('character.fingernail-landmarks-missing');
  if (requiredBlendPairs.some((pair) => (blendedVertices[pair] ?? 0) < 4))
    issues.push('character.finger-deformation-coverage');
  const flexion: Record<string, number> = {};
  for (const side of sides) {
    const pose: Record<string, JointDelta> = {};
    const direction = side === 'left' ? -1 : 1;
    for (const finger of fingerNames)
      for (let segment = 1; segment <= 3; segment++)
        pose[`${side}-${finger}-${segment}`] = {
          rotation: [0, 0, direction * (finger === 'thumb' ? 0.28 : 0.42)],
        };
    const deformed = deformSkinnedPositionsDualQuaternion(asset, pose);
    let maximum = 0;
    for (let vertex = 0; vertex < (asset.skinIndices?.length ?? 0); vertex++) {
      const belongsToSide = asset.skinIndices![vertex]!.some((index, influence) => {
        const id = asset.skeleton[index]?.id;
        return Boolean(
          id?.startsWith(`${side}-`) &&
          required.includes(id) &&
          asset.skinWeights![vertex]![influence]! >= 0.5,
        );
      });
      if (belongsToSide)
        maximum = Math.max(
          maximum,
          Math.hypot(...subtract(deformed[vertex]!, asset.positions[vertex]!)),
        );
    }
    flexion[side] = maximum;
  }
  if (Object.values(flexion).some((distance) => distance < 0.01))
    issues.push('character.finger-flexion-inert');
  return {
    valid: issues.length === 0,
    issues,
    checks: {
      ownedVertices,
      nailOwnedVertices,
      blendedVertices,
      requiredBlendPairs,
      flexion,
    },
  };
}
