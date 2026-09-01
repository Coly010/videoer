import { dirname, resolve } from 'node:path';
import { loadGeometry } from '../geometry/io.js';
import { deformGeometryAtMotionSample } from '../geometry/kinematics.js';
import type { GeometryAsset, Vec3 } from '../geometry/model.js';
import { transformPoint } from '../interactions/transforms.js';
import { loadMotionClip } from '../motion/io.js';
import { sampleMotion, type MotionClip } from '../motion/model.js';
import type { CinematicScene } from './model.js';

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const multiply = (value: Vec3, scale: number): Vec3 => [
  value[0] * scale,
  value[1] * scale,
  value[2] * scale,
];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const length = (value: Vec3) => Math.hypot(...value);
const interpolate = (a: Vec3, b: Vec3, amount: number): Vec3 =>
  add(a, multiply(subtract(b, a), amount));

function easingAmount(amount: number, easing: 'linear' | 'ease-in-out') {
  if (easing === 'linear') return amount;
  return 0.5 - Math.cos(Math.PI * amount) / 2;
}

/** Samples the exact declarative camera interpolation implemented by the Blender backend. */
export function sampleCinematicCamera(scene: CinematicScene, timeSeconds: number) {
  const keyframes = scene.camera.keyframes;
  const time = Math.min(scene.durationSeconds, Math.max(0, timeSeconds));
  const endIndex = keyframes.findIndex((keyframe) => keyframe.time >= time);
  if (endIndex <= 0) return structuredClone(keyframes[0]!);
  const end = keyframes[endIndex]!;
  const start = keyframes[endIndex - 1]!;
  const progress = (time - start.time) / (end.time - start.time);
  const amount = easingAmount(progress, start.easing);
  return {
    time,
    position: interpolate(start.position, end.position, amount),
    target: interpolate(start.target, end.target, amount),
    lensMillimeters: start.lensMillimeters + (end.lensMillimeters - start.lensMillimeters) * amount,
    easing: start.easing,
  };
}

interface Triangle {
  entityId: string;
  a: Vec3;
  b: Vec3;
  c: Vec3;
}

function pointTriangleDistance(point: Vec3, triangle: Triangle) {
  const ab = subtract(triangle.b, triangle.a);
  const ac = subtract(triangle.c, triangle.a);
  const ap = subtract(point, triangle.a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return length(ap);

  const bp = subtract(point, triangle.b);
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return length(bp);

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return length(subtract(point, add(triangle.a, multiply(ab, v))));
  }

  const cp = subtract(point, triangle.c);
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return length(cp);

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return length(subtract(point, add(triangle.a, multiply(ac, w))));
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const edge = subtract(triangle.c, triangle.b);
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return length(subtract(point, add(triangle.b, multiply(edge, w))));
  }

  const denominator = 1 / (va + vb + vc);
  const v = vb * denominator;
  const w = vc * denominator;
  return length(subtract(point, add(triangle.a, add(multiply(ab, v), multiply(ac, w)))));
}

/** Returns the distance from segment origin to its first triangle intersection. */
function segmentTriangleIntersection(origin: Vec3, target: Vec3, triangle: Triangle) {
  const direction = subtract(target, origin);
  const edge1 = subtract(triangle.b, triangle.a);
  const edge2 = subtract(triangle.c, triangle.a);
  const cross = (a: Vec3, b: Vec3): Vec3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const p = cross(direction, edge2);
  const determinant = dot(edge1, p);
  if (Math.abs(determinant) < 1e-10) return undefined;
  const inverse = 1 / determinant;
  const offset = subtract(origin, triangle.a);
  const u = dot(offset, p) * inverse;
  if (u < 0 || u > 1) return undefined;
  const q = cross(offset, edge1);
  const v = dot(direction, q) * inverse;
  if (v < 0 || u + v > 1) return undefined;
  const fraction = dot(edge2, q) * inverse;
  if (fraction < 0 || fraction > 1) return undefined;
  return length(direction) * fraction;
}

interface Obstacle {
  entity: CinematicScene['entities'][number];
  geometry: GeometryAsset;
  motion?: MotionClip;
}

async function loadObstacles(
  scene: CinematicScene,
  sceneFile: string,
  obstacleEntityIds: string[],
) {
  const sourceDirectory = dirname(resolve(sceneFile));
  const obstacles: Obstacle[] = [];
  for (const entityId of obstacleEntityIds) {
    const entity = scene.entities.find((candidate) => candidate.id === entityId)!;
    const geometry = await loadGeometry(resolve(sourceDirectory, entity.geometryPath));
    const motion = entity.motion
      ? await loadMotionClip(resolve(sourceDirectory, entity.motion.path))
      : undefined;
    obstacles.push({ entity, geometry, ...(motion ? { motion } : {}) });
  }
  return obstacles;
}

function obstacleTrianglesAtTime(
  obstacle: Obstacle,
  sceneTimeSeconds: number,
  sceneDurationSeconds: number,
): Triangle[] {
  const { entity, geometry, motion } = obstacle;
  let localPositions = geometry.positions;
  if (entity.motion && motion) {
    const bindingEnd = entity.motion.endSeconds ?? sceneDurationSeconds;
    const sourceEnd = entity.motion.sourceEndSeconds ?? motion.durationSeconds;
    const progress = Math.max(
      0,
      Math.min(
        1,
        (sceneTimeSeconds - entity.motion.startSeconds) / (bindingEnd - entity.motion.startSeconds),
      ),
    );
    const sourceTime =
      entity.motion.sourceStartSeconds + (sourceEnd - entity.motion.sourceStartSeconds) * progress;
    localPositions = deformGeometryAtMotionSample(geometry, sampleMotion(motion, sourceTime));
  }
  const positions = localPositions.map((point) => transformPoint(point, entity.transform));
  const triangles: Triangle[] = [];
  for (let index = 0; index < geometry.indices.length; index += 3) {
    triangles.push({
      entityId: entity.id,
      a: positions[geometry.indices[index]!]!,
      b: positions[geometry.indices[index + 1]!]!,
      c: positions[geometry.indices[index + 2]!]!,
    });
  }
  return triangles;
}

function trianglesAtTime(
  obstacles: Obstacle[],
  sceneTimeSeconds: number,
  sceneDurationSeconds: number,
) {
  return obstacles.flatMap((obstacle) =>
    obstacleTrianglesAtTime(obstacle, sceneTimeSeconds, sceneDurationSeconds),
  );
}

export async function verifyCameraPathClearance(
  scene: CinematicScene,
  sceneFile: string,
  gate: Extract<CinematicScene['qualityGates'][number], { type: 'camera-path-clearance' }>,
) {
  const obstacles = await loadObstacles(scene, sceneFile, gate.obstacleEntityIds);
  let triangleCount = 0;
  let minimumCameraClearance = Number.POSITIVE_INFINITY;
  let closestObstacleEntityId = '';
  let closestSampleTimeSeconds = 0;
  let maximumOcclusionBeforeTarget = 0;
  let blockedSightlineSamples = 0;
  let blockedObstacleEntityId = '';
  for (let index = 0; index < gate.sampleCount; index++) {
    const timeSeconds = (scene.durationSeconds * index) / (gate.sampleCount - 1);
    const camera = sampleCinematicCamera(scene, timeSeconds);
    const triangles = trianglesAtTime(obstacles, timeSeconds, scene.durationSeconds);
    triangleCount = triangles.length;
    for (const triangle of triangles) {
      const clearance = pointTriangleDistance(camera.position, triangle);
      if (clearance < minimumCameraClearance) {
        minimumCameraClearance = clearance;
        closestObstacleEntityId = triangle.entityId;
        closestSampleTimeSeconds = timeSeconds;
      }
    }
    const sightlineDistance = length(subtract(camera.target, camera.position));
    let firstIntersection = Number.POSITIVE_INFINITY;
    let firstIntersectionEntityId = '';
    for (const triangle of triangles) {
      const intersection = segmentTriangleIntersection(camera.position, camera.target, triangle);
      if (intersection !== undefined && intersection < firstIntersection) {
        firstIntersection = intersection;
        firstIntersectionEntityId = triangle.entityId;
      }
    }
    const occlusionBeforeTarget = Number.isFinite(firstIntersection)
      ? sightlineDistance - firstIntersection
      : 0;
    maximumOcclusionBeforeTarget = Math.max(maximumOcclusionBeforeTarget, occlusionBeforeTarget);
    if (occlusionBeforeTarget > gate.targetOcclusionToleranceMeters) {
      blockedSightlineSamples++;
      blockedObstacleEntityId ||= firstIntersectionEntityId;
    }
  }
  const passed =
    minimumCameraClearance >= gate.minimumCameraClearanceMeters && blockedSightlineSamples === 0;
  return {
    id: gate.id,
    status: passed ? ('pass' as const) : ('fail' as const),
    message: passed
      ? 'Camera body path and semantic target sightline remain clear of declared obstacles'
      : 'Camera body path or semantic target sightline intersects a declared obstacle',
    measurements: {
      sampleCount: gate.sampleCount,
      triangleCount,
      minimumCameraClearanceMeters: minimumCameraClearance,
      requiredCameraClearanceMeters: gate.minimumCameraClearanceMeters,
      maximumOcclusionBeforeTargetMeters: maximumOcclusionBeforeTarget,
      targetOcclusionToleranceMeters: gate.targetOcclusionToleranceMeters,
      blockedSightlineSamples,
      closestObstacleEntityId,
      closestSampleTimeSeconds,
      blockedObstacleEntityId,
    },
  };
}
