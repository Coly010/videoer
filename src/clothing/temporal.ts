import {
  bindDeltaForWorldDisplacement,
  deformSkinnedPositions,
  jointWorldTransforms,
} from '../geometry/kinematics.js';
import { geometryAssetSchema } from '../geometry/model.js';
import type { GeometryAsset, Vec3 } from '../geometry/model.js';
import { motionClipSchema, sampleMotion, type MotionClip } from '../motion/model.js';

export const CLOTHING_TEMPORAL_SAMPLE_COUNT = 49;
export const LONG_DRESS_MAX_COLLISION_DEPTH_METERS = 0.006;
export const LONG_DRESS_MAX_COLLIDING_SAMPLE_FRACTION = 0.002;
export const LONG_DRESS_MAX_LATERAL_EXPANSION_RATIO = 1.15;
export const LONG_DRESS_MAX_DEPTH_EXPANSION_RATIO = 1.15;
export const LONG_DRESS_MAX_AREA_EXPANSION_RATIO = 1.2;
export const LONG_DRESS_MAX_ADJACENT_AREA_DELTA_RATIO = 0.06;

interface Capsule {
  joint: string;
  child: string;
  radius: number;
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a: Vec3, b: Vec3) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function distanceToSegment(point: Vec3, start: Vec3, end: Vec3) {
  const segment = subtract(end, start);
  const denominator = dot(segment, segment);
  const amount =
    denominator > 0
      ? Math.max(0, Math.min(1, dot(subtract(point, start), segment) / denominator))
      : 0;
  const nearest: Vec3 = [
    start[0] + segment[0] * amount,
    start[1] + segment[1] * amount,
    start[2] + segment[2] * amount,
  ];
  return Math.hypot(...subtract(point, nearest));
}

function nearestPointOnSegment(point: Vec3, start: Vec3, end: Vec3): Vec3 {
  const segment = subtract(end, start);
  const denominator = dot(segment, segment);
  const amount =
    denominator > 0
      ? Math.max(0, Math.min(1, dot(subtract(point, start), segment) / denominator))
      : 0;
  return [
    start[0] + segment[0] * amount,
    start[1] + segment[1] * amount,
    start[2] + segment[2] * amount,
  ];
}

function materialVertexSet(asset: GeometryAsset, materialId: string) {
  const selected = new Set<number>();
  for (const group of asset.materialGroups) {
    if (group.materialId !== materialId) continue;
    for (const vertex of asset.indices.slice(group.start, group.start + group.count))
      selected.add(vertex);
  }
  return selected;
}

function motionPose(clip: MotionClip, seconds: number) {
  const sampled = sampleMotion(clip, seconds);
  const pose: Record<string, { translation?: Vec3; rotation?: Vec3 }> = {};
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

function bodyCapsules(body: GeometryAsset, excludedVertices: Set<number>) {
  if (!body.skinIndices || !body.skinWeights) return [];
  const rest = jointWorldTransforms(body);
  const pairs: Array<[string, string]> = [
    ['left-forearm', 'left-hand'],
    ['right-forearm', 'right-hand'],
    ['left-thigh', 'left-shin'],
    ['left-shin', 'left-foot'],
    ['left-foot', 'left-toe'],
    ['right-thigh', 'right-shin'],
    ['right-shin', 'right-foot'],
    ['right-foot', 'right-toe'],
  ];
  return pairs.flatMap(([joint, child]): Capsule[] => {
    const jointIndex = body.skeleton.findIndex((candidate) => candidate.id === joint);
    const start = rest.get(joint)?.position;
    const end = rest.get(child)?.position;
    if (jointIndex < 0 || !start || !end) return [];
    const distances = body.positions.flatMap((position, vertex) => {
      if (excludedVertices.has(vertex)) return [];
      const indices = body.skinIndices![vertex]!;
      const weights = body.skinWeights![vertex]!;
      let dominant = 0;
      for (let index = 1; index < 4; index++)
        if (weights[index]! > weights[dominant]!) dominant = index;
      if (indices[dominant] !== jointIndex || weights[dominant]! < 0.5) return [];
      return [distanceToSegment(position, start, end)];
    });
    if (!distances.length) return [];
    const radius = Math.max(...distances) + 0.002;
    return radius > 0 ? [{ joint, child, radius }] : [];
  });
}

function bounds(points: Vec3[]) {
  const xs = points.map((point) => point[0]);
  const zs = points.map((point) => point[2]);
  const width = Math.max(...xs) - Math.min(...xs);
  const depth = Math.max(...zs) - Math.min(...zs);
  return { width, depth, area: width * depth };
}

function selectedEdges(asset: GeometryAsset, selected: Set<number>) {
  const edges = new Map<string, [number, number]>();
  for (let index = 0; index < asset.indices.length; index += 3) {
    const triangle = asset.indices.slice(index, index + 3);
    for (const [a, b] of [
      [triangle[0]!, triangle[1]!],
      [triangle[1]!, triangle[2]!],
      [triangle[2]!, triangle[0]!],
    ] as Array<[number, number]>) {
      if (!selected.has(a) || !selected.has(b)) continue;
      const edge: [number, number] = a < b ? [a, b] : [b, a];
      edges.set(`${edge[0]}:${edge[1]}`, edge);
    }
  }
  return [...edges.values()];
}

function selectedBendingEdges(asset: GeometryAsset, selected: Set<number>) {
  const opposites = new Map<string, number[]>();
  for (let index = 0; index < asset.indices.length; index += 3) {
    const triangle = asset.indices.slice(index, index + 3) as [number, number, number];
    if (!triangle.every((vertex) => selected.has(vertex))) continue;
    for (const [a, b, opposite] of [
      [triangle[0], triangle[1], triangle[2]],
      [triangle[1], triangle[2], triangle[0]],
      [triangle[2], triangle[0], triangle[1]],
    ] as Array<[number, number, number]>) {
      const edge = a < b ? `${a}:${b}` : `${b}:${a}`;
      const values = opposites.get(edge) ?? [];
      values.push(opposite);
      opposites.set(edge, values);
    }
  }
  const bending = new Map<string, [number, number]>();
  for (const values of opposites.values()) {
    if (values.length !== 2 || values[0] === values[1]) continue;
    const edge: [number, number] =
      values[0]! < values[1]! ? [values[0]!, values[1]!] : [values[1]!, values[0]!];
    bending.set(`${edge[0]}:${edge[1]}`, edge);
  }
  return [...bending.values()];
}

function bindPositionsWithMorphs(asset: GeometryAsset, sampled: ReturnType<typeof sampleMotion>) {
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

export function verifyTemporalClothing(
  garment: GeometryAsset,
  body: GeometryAsset,
  motion: MotionClip,
  options: { materialId?: string; sampleCount?: number } = {},
) {
  const materialId = options.materialId ?? 'dress';
  const sampleCount = options.sampleCount ?? CLOTHING_TEMPORAL_SAMPLE_COUNT;
  const issues: string[] = [];
  if (sampleCount < 3)
    throw new Error('Temporal clothing verification requires at least 3 samples');
  if (!garment.skinIndices || !garment.skinWeights) issues.push('garment lacks skinning');
  if (!body.skinIndices || !body.skinWeights) issues.push('body lacks skinning');
  if (
    garment.skeleton.map((joint) => joint.id).join('\0') !==
    body.skeleton.map((joint) => joint.id).join('\0')
  )
    issues.push('garment and body skeletons differ');
  const selected = materialVertexSet(garment, materialId);
  const hipY = jointWorldTransforms(garment).get('hips')?.position[1];
  const thighIndices = new Set(
    ['left-thigh', 'right-thigh']
      .map((id) => garment.skeleton.findIndex((joint) => joint.id === id))
      .filter((index) => index >= 0),
  );
  if (hipY === undefined) issues.push('garment lacks a hips joint');
  const skirtVertices = [...selected].filter((vertex) => {
    if (garment.positions[vertex]![1] >= (hipY ?? 0) - 0.02) return false;
    return garment.skinIndices?.[vertex]?.some(
      (joint, influence) =>
        thighIndices.has(joint) && garment.skinWeights![vertex]![influence]! > 0,
    );
  });
  if (!skirtVertices.length)
    issues.push(`material '${materialId}' has no below-hip garment vertices`);
  const excludedBodyVertices = garment === body ? selected : new Set<number>();
  const capsules = bodyCapsules(body, excludedBodyVertices);
  if (capsules.length !== 8)
    issues.push('body lacks complete bilateral arm, leg, and foot collision proxies');
  if (issues.length)
    return {
      valid: false,
      issues,
      sampleCount,
      garmentVertexCount: skirtVertices.length,
      bodyCapsuleCount: capsules.length,
      collision: {
        collidingVertexSamples: 0,
        sampledVertexCount: 0,
        collidingSampleFraction: 0,
        maximumDepthMeters: 0,
      },
      silhouette: {
        restWidthMeters: 0,
        restDepthMeters: 0,
        maximumLateralExpansionRatio: 0,
        maximumDepthExpansionRatio: 0,
        maximumAreaExpansionRatio: 0,
        maximumAdjacentAreaDeltaRatio: 0,
        maximumEdgeStretchRatio: 0,
        maximumEdgeCompressionRatio: 0,
      },
    };

  const restPoints = skirtVertices.map((vertex) => garment.positions[vertex]!);
  const restBounds = bounds(restPoints);
  const edges = selectedEdges(garment, new Set(skirtVertices));
  const restEdgeLengths = edges.map(([a, b]) =>
    Math.hypot(...subtract(garment.positions[a]!, garment.positions[b]!)),
  );
  let collidingVertexSamples = 0;
  let maximumDepthMeters = 0;
  let worstCollision:
    | { sample: number; seconds: number; vertex: number; capsule: string; depthMeters: number }
    | undefined;
  let maximumLateralExpansionRatio = 0;
  let maximumDepthExpansionRatio = 0;
  let maximumAreaExpansionRatio = 0;
  let maximumAdjacentAreaDeltaRatio = 0;
  let maximumEdgeStretchRatio = 1;
  let minimumEdgeLengthRatio = 1;
  let worstEdgeStretch:
    | { sample: number; vertices: [number, number]; restMeters: number; posedMeters: number }
    | undefined;
  let previousAreaRatio: number | undefined;
  for (let sample = 0; sample < sampleCount; sample++) {
    const seconds = (sample / (sampleCount - 1)) * motion.durationSeconds;
    const sampled = sampleMotion(motion, seconds);
    const pose = motionPose(motion, seconds);
    const garmentPositions = deformSkinnedPositions(
      garment,
      pose,
      bindPositionsWithMorphs(garment, sampled),
    );
    const bodyWorld = jointWorldTransforms(body, pose);
    const framePoints = skirtVertices.map((vertex) => garmentPositions[vertex]!);
    const frameBounds = bounds(framePoints);
    const widthRatio = frameBounds.width / restBounds.width;
    const depthRatio = frameBounds.depth / restBounds.depth;
    const areaRatio = frameBounds.area / restBounds.area;
    maximumLateralExpansionRatio = Math.max(maximumLateralExpansionRatio, widthRatio);
    maximumDepthExpansionRatio = Math.max(maximumDepthExpansionRatio, depthRatio);
    maximumAreaExpansionRatio = Math.max(maximumAreaExpansionRatio, areaRatio);
    if (previousAreaRatio !== undefined)
      maximumAdjacentAreaDeltaRatio = Math.max(
        maximumAdjacentAreaDeltaRatio,
        Math.abs(areaRatio - previousAreaRatio),
      );
    previousAreaRatio = areaRatio;
    edges.forEach(([a, b], edgeIndex) => {
      const posedMeters = Math.hypot(...subtract(garmentPositions[a]!, garmentPositions[b]!));
      const ratio = posedMeters / restEdgeLengths[edgeIndex]!;
      if (ratio > maximumEdgeStretchRatio) {
        maximumEdgeStretchRatio = ratio;
        worstEdgeStretch = {
          sample,
          vertices: [a, b],
          restMeters: restEdgeLengths[edgeIndex]!,
          posedMeters,
        };
      }
      minimumEdgeLengthRatio = Math.min(minimumEdgeLengthRatio, ratio);
    });
    for (const [pointIndex, point] of framePoints.entries()) {
      let deepest = 0;
      let deepestCapsule = '';
      for (const capsule of capsules) {
        const start = bodyWorld.get(capsule.joint)!.position;
        const end = bodyWorld.get(capsule.child)!.position;
        const depth = capsule.radius - distanceToSegment(point, start, end);
        if (depth > deepest) {
          deepest = depth;
          deepestCapsule = capsule.joint;
        }
      }
      if (deepest > 0) {
        collidingVertexSamples++;
        if (deepest > maximumDepthMeters) {
          maximumDepthMeters = deepest;
          worstCollision = {
            sample,
            seconds,
            vertex: skirtVertices[pointIndex]!,
            capsule: deepestCapsule,
            depthMeters: deepest,
          };
        }
      }
    }
  }
  const sampledVertexCount = sampleCount * skirtVertices.length;
  const collidingSampleFraction = collidingVertexSamples / sampledVertexCount;
  if (maximumDepthMeters > LONG_DRESS_MAX_COLLISION_DEPTH_METERS)
    issues.push('garment penetrates the animated body collision proxy');
  if (collidingSampleFraction > LONG_DRESS_MAX_COLLIDING_SAMPLE_FRACTION)
    issues.push('garment collision persists across too many temporal vertex samples');
  if (maximumLateralExpansionRatio > LONG_DRESS_MAX_LATERAL_EXPANSION_RATIO)
    issues.push('garment lateral silhouette expands beyond the long-dress stability limit');
  if (maximumDepthExpansionRatio > LONG_DRESS_MAX_DEPTH_EXPANSION_RATIO)
    issues.push('garment depth silhouette expands beyond the long-dress stability limit');
  if (maximumAreaExpansionRatio > LONG_DRESS_MAX_AREA_EXPANSION_RATIO)
    issues.push('garment silhouette area expands beyond the long-dress stability limit');
  if (maximumAdjacentAreaDeltaRatio > LONG_DRESS_MAX_ADJACENT_AREA_DELTA_RATIO)
    issues.push('garment silhouette changes discontinuously between adjacent samples');
  if (maximumEdgeStretchRatio > 1.35)
    issues.push('garment local surface edges stretch beyond the temporal stability limit');
  if (minimumEdgeLengthRatio < 0.65)
    issues.push('garment local surface edges compress beyond the temporal stability limit');
  return {
    valid: issues.length === 0,
    issues,
    sampleCount,
    garmentVertexCount: skirtVertices.length,
    bodyCapsuleCount: capsules.length,
    collision: {
      collidingVertexSamples,
      sampledVertexCount,
      collidingSampleFraction,
      maximumDepthMeters,
      worstCollision,
    },
    silhouette: {
      restWidthMeters: restBounds.width,
      restDepthMeters: restBounds.depth,
      maximumLateralExpansionRatio,
      maximumDepthExpansionRatio,
      maximumAreaExpansionRatio,
      maximumAdjacentAreaDeltaRatio,
      maximumEdgeStretchRatio,
      maximumEdgeCompressionRatio: 1 - minimumEdgeLengthRatio,
      worstEdgeStretch,
    },
  };
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale(value: Vec3, factor: number): Vec3 {
  return [value[0] * factor, value[1] * factor, value[2] * factor];
}

/**
 * Bakes sparse pose-space cloth correctives into ordinary renderer-independent
 * morph targets and motion tracks. Both Blender and Three.js already consume
 * this pair, so collision response is deterministic and provider-free.
 */
export function bakePoseSpaceClothCorrectives(
  garment: GeometryAsset,
  body: GeometryAsset,
  motion: MotionClip,
  options: {
    materialId?: string;
    sampleCount?: number;
    clearanceMeters?: number;
    targetPrefix?: string;
  } = {},
) {
  const materialId = options.materialId ?? 'dress';
  const sampleCount = options.sampleCount ?? CLOTHING_TEMPORAL_SAMPLE_COUNT;
  const clearanceMeters = options.clearanceMeters ?? 0.003;
  const targetPrefix = options.targetPrefix ?? 'cloth-corrective';
  if (!/^[a-z][a-z0-9-]*$/.test(targetPrefix))
    throw new Error('Pose-space cloth target prefix must be a local identifier');
  if (sampleCount < 3) throw new Error('Pose-space cloth correction requires at least 3 samples');
  if (!(clearanceMeters > 0 && clearanceMeters <= 0.05))
    throw new Error('Pose-space cloth clearance must be greater than zero and at most 0.05m');
  const selected = materialVertexSet(garment, materialId);
  const hipY = jointWorldTransforms(garment).get('hips')?.position[1];
  if (hipY === undefined) throw new Error('Pose-space cloth correction requires a hips joint');
  const thighs = new Set(
    ['left-thigh', 'right-thigh']
      .map((id) => garment.skeleton.findIndex((joint) => joint.id === id))
      .filter((index) => index >= 0),
  );
  const skirtVertices = new Set(
    [...selected].filter(
      (vertex) =>
        garment.positions[vertex]![1] < hipY - 0.02 &&
        garment.skinIndices?.[vertex]?.some(
          (joint, influence) => thighs.has(joint) && garment.skinWeights![vertex]![influence]! > 0,
        ),
    ),
  );
  if (!skirtVertices.size)
    throw new Error(`Material '${materialId}' has no correctable skirt region`);
  const capsules = bodyCapsules(body, garment === body ? selected : new Set());
  if (capsules.length !== 8)
    throw new Error(
      'Pose-space cloth correction requires complete bilateral arm, leg, and foot collision proxies',
    );
  const clothEdges = selectedEdges(garment, skirtVertices);
  const bendingEdges = selectedBendingEdges(garment, skirtVertices);
  const anchoredVertices = new Set(
    [...skirtVertices].filter((vertex) => garment.positions[vertex]![1] >= hipY - 0.06),
  );
  const morphTargets: GeometryAsset['morphTargets'] = [];
  const targetTimes: number[] = [];
  let correctedPoseCount = 0;
  let correctedVertexCount = 0;
  let maximumRawDepthMeters = 0;
  for (let sample = 0; sample < sampleCount; sample++) {
    const seconds = (sample / (sampleCount - 1)) * motion.durationSeconds;
    const sampledMotion = sampleMotion(motion, seconds);
    const pose = motionPose(motion, seconds);
    const positions = deformSkinnedPositions(
      garment,
      pose,
      bindPositionsWithMorphs(garment, sampledMotion),
    );
    const bodyWorld = jointWorldTransforms(body, pose);
    const simulated = new Map<number, Vec3>(
      [...skirtVertices].map((vertex) => [vertex, [...positions[vertex]!] as Vec3]),
    );
    const restLengths = clothEdges.map(([a, b]) =>
      Math.hypot(...subtract(positions[a]!, positions[b]!)),
    );
    const restBendingLengths = bendingEdges.map(([a, b]) =>
      Math.hypot(...subtract(positions[a]!, positions[b]!)),
    );
    let rawCollisionCount = 0;
    for (const vertex of skirtVertices)
      for (const capsule of capsules) {
        const start = bodyWorld.get(capsule.joint)!.position;
        const end = bodyWorld.get(capsule.child)!.position;
        const depth = capsule.radius - distanceToSegment(positions[vertex]!, start, end);
        if (depth > 0) {
          rawCollisionCount++;
          maximumRawDepthMeters = Math.max(maximumRawDepthMeters, depth);
        }
      }
    if (!rawCollisionCount) continue;
    for (let iteration = 0; iteration < 160; iteration++) {
      for (const vertex of skirtVertices) {
        let point = simulated.get(vertex)!;
        for (const capsule of capsules) {
          const start = bodyWorld.get(capsule.joint)!.position;
          const end = bodyWorld.get(capsule.child)!.position;
          const nearest = nearestPointOnSegment(point, start, end);
          const radial = subtract(point, nearest);
          const distance = Math.hypot(...radial);
          const depth = capsule.radius + clearanceMeters - distance;
          if (depth <= 0) continue;
          const direction = distance > 1e-8 ? scale(radial, 1 / distance) : ([0, 0, -1] as Vec3);
          point = add(point, scale(direction, depth));
        }
        simulated.set(vertex, point);
      }
      const solveDistanceConstraints = (
        constraints: Array<[number, number]>,
        lengths: number[],
        stiffness: number,
      ) =>
        constraints.forEach(([a, b], edgeIndex) => {
          const first = simulated.get(a)!;
          const second = simulated.get(b)!;
          const delta = subtract(second, first);
          const length = Math.hypot(...delta);
          if (length < 1e-8) return;
          const correction = scale(delta, ((length - lengths[edgeIndex]!) / length) * stiffness);
          simulated.set(a, add(first, scale(correction, 0.5)));
          simulated.set(b, subtract(second, scale(correction, 0.5)));
        });
      for (let edgeIteration = 0; edgeIteration < 6; edgeIteration++) {
        solveDistanceConstraints(clothEdges, restLengths, 1);
        solveDistanceConstraints(bendingEdges, restBendingLengths, 0.35);
      }
      for (const vertex of anchoredVertices) {
        const point = simulated.get(vertex)!;
        simulated.set(vertex, add(point, scale(subtract(positions[vertex]!, point), 0.03)));
      }
    }
    // Finish collision projection after constraint relaxation.
    for (const vertex of skirtVertices) {
      let point = simulated.get(vertex)!;
      for (const capsule of capsules) {
        const start = bodyWorld.get(capsule.joint)!.position;
        const end = bodyWorld.get(capsule.child)!.position;
        const nearest = nearestPointOnSegment(point, start, end);
        const radial = subtract(point, nearest);
        const distance = Math.hypot(...radial);
        const depth = capsule.radius + clearanceMeters - distance;
        if (depth > 0) {
          const direction = distance > 1e-8 ? scale(radial, 1 / distance) : ([0, 0, -1] as Vec3);
          point = add(point, scale(direction, depth));
        }
      }
      simulated.set(vertex, point);
    }
    const worldCorrections = new Map<number, Vec3>();
    for (const [vertex, point] of simulated) {
      const correction = subtract(point, positions[vertex]!);
      if (Math.hypot(...correction) > 1e-7) worldCorrections.set(vertex, correction);
    }
    const vertexIndices = [...worldCorrections.keys()].sort((a, b) => a - b);
    if (!vertexIndices.length) continue;
    const id = `${targetPrefix}-${String(sample).padStart(3, '0')}`;
    morphTargets.push({
      id,
      vertexIndices,
      positionDeltas: vertexIndices.map((vertex) =>
        bindDeltaForWorldDisplacement(garment, vertex, pose, worldCorrections.get(vertex)!),
      ),
    });
    targetTimes.push(seconds);
    correctedPoseCount++;
    correctedVertexCount += vertexIndices.length;
  }
  const existingTargets = new Set(garment.morphTargets.map((target) => target.id));
  for (const target of morphTargets)
    if (existingTargets.has(target.id)) throw new Error(`Geometry already contains '${target.id}'`);
  const correctedGeometry = geometryAssetSchema.parse({
    ...structuredClone(garment),
    morphTargets: [...structuredClone(garment.morphTargets), ...morphTargets],
    metadata: {
      ...garment.metadata,
      poseSpaceClothCorrection: {
        generator: 'videoer.pose-space-cloth-corrective.v1',
        materialId,
        sampleCount,
        clearanceMeters,
        correctedPoseCount,
        correctedVertexCount,
      },
    },
  });
  const allTimes = Array.from(
    { length: sampleCount },
    (_, sample) => (sample / (sampleCount - 1)) * motion.durationSeconds,
  );
  const correctedMotion = motionClipSchema.parse({
    ...structuredClone(motion),
    morphTracks: [
      ...structuredClone(motion.morphTracks),
      ...morphTargets.map((target, targetIndex) => ({
        target: target.id,
        property: 'weight' as const,
        keyframes: allTimes.map((time) => ({
          time,
          value: Math.max(
            0,
            1 -
              Math.abs(time - targetTimes[targetIndex]!) /
                (motion.durationSeconds / (sampleCount - 1)),
          ),
          easing: 'linear' as const,
        })),
      })),
    ],
    metadata: {
      ...motion.metadata,
      poseSpaceClothCorrection: {
        generator: 'videoer.pose-space-cloth-corrective.v1',
        targetGeometry: garment.id,
        correctedPoseCount,
        clearanceMeters,
      },
    },
  });
  return {
    geometry: correctedGeometry,
    motion: correctedMotion,
    report: {
      generator: 'videoer.pose-space-cloth-corrective.v1',
      materialId,
      sampleCount,
      clearanceMeters,
      correctedPoseCount,
      correctedVertexCount,
      maximumRawDepthMeters,
      addedMorphTargetCount: morphTargets.length,
    },
  };
}
