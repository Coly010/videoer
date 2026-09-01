import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { loadGeometry } from '../geometry/io.js';
import type { Vec3 } from '../geometry/model.js';
import { transformPoint } from '../interactions/transforms.js';
import { defaultCinematicFogDomainPolicy, type CinematicScene } from './model.js';

export interface ResolvedFiniteFogDomain {
  schemaVersion: 1;
  policy: 'scene-envelope-v1' | 'explicit-box-v1';
  coordinateSystem: 'videoer-y-up-meters';
  requestedPolicy: NonNullable<CinematicScene['atmosphere']['fogDomain']>;
  sourcePointCount: number;
  sourceBoundsMinimum: Vec3;
  sourceBoundsMaximum: Vec3;
  includedVisibleEntityIds: string[];
  includedCameraKeyframeTimes: number[];
  containment: {
    allSourcePointsContained: true;
    allVisibleEntityBoundsContained: true;
    allCameraPositionsContained: true;
    allCameraTargetsContained: true;
  };
  boundsMinimum: Vec3;
  boundsMaximum: Vec3;
  center: Vec3;
  size: Vec3;
  maximumExtentMeters: number;
  edgeFalloffMeters: number;
  derivationSha256: string;
}

const boundsOf = (points: Vec3[]) => {
  if (!points.length) throw new Error('finite fog domain requires at least one scene point');
  const minimum: Vec3 = [...points[0]!] as Vec3;
  const maximum: Vec3 = [...points[0]!] as Vec3;
  for (const point of points.slice(1))
    for (let axis = 0; axis < 3; axis += 1) {
      minimum[axis] = Math.min(minimum[axis]!, point[axis]!);
      maximum[axis] = Math.max(maximum[axis]!, point[axis]!);
    }
  return { minimum, maximum };
};

function expandAxis(minimum: number, maximum: number, minimumSpan: number, padding: number) {
  const center = (minimum + maximum) / 2;
  const span = Math.max(maximum - minimum, minimumSpan);
  return [center - span / 2 - padding, center + span / 2 + padding] as const;
}

function contains(boundsMinimum: Vec3, boundsMaximum: Vec3, point: Vec3) {
  return point.every(
    (value, axis) => value >= boundsMinimum[axis]! - 1e-9 && value <= boundsMaximum[axis]! + 1e-9,
  );
}

/** Resolves the portable scene envelope once; renderers consume these exact deterministic bounds. */
export async function resolveFiniteFogDomain(
  scene: CinematicScene,
  sceneFile: string,
): Promise<ResolvedFiniteFogDomain> {
  const sourceDirectory = dirname(resolve(sceneFile));
  const cameraPositions = scene.camera.keyframes.map((keyframe) => keyframe.position);
  const cameraTargets = scene.camera.keyframes.map((keyframe) => keyframe.target);
  const entityPoints = new Map<string, Vec3[]>();
  const visibleEntities = scene.entities.filter((candidate) => candidate.visible);
  for (const entity of visibleEntities) {
    const geometry = await loadGeometry(resolve(sourceDirectory, entity.geometryPath));
    entityPoints.set(
      entity.id,
      geometry.positions.map((position) => transformPoint(position, entity.transform)),
    );
  }
  const points: Vec3[] = [
    ...cameraPositions,
    ...cameraTargets,
    ...[...entityPoints.values()].flat(),
  ];
  const sourceBounds = boundsOf(points);
  const policy = scene.atmosphere.fogDomain ?? defaultCinematicFogDomainPolicy;
  let boundsMinimum: Vec3;
  let boundsMaximum: Vec3;
  if (policy.policy === 'scene-envelope-v1') {
    const x = expandAxis(
      sourceBounds.minimum[0],
      sourceBounds.maximum[0],
      policy.minimumHorizontalSpanMeters,
      policy.horizontalPaddingMeters,
    );
    const verticalBase = expandAxis(
      sourceBounds.minimum[1],
      sourceBounds.maximum[1],
      policy.minimumVerticalSpanMeters,
      0,
    );
    const z = expandAxis(
      sourceBounds.minimum[2],
      sourceBounds.maximum[2],
      policy.minimumHorizontalSpanMeters,
      policy.horizontalPaddingMeters,
    );
    boundsMinimum = [x[0], verticalBase[0] - policy.belowPaddingMeters, z[0]];
    boundsMaximum = [x[1], verticalBase[1] + policy.abovePaddingMeters, z[1]];
  } else {
    boundsMinimum = [...policy.boundsMinimum];
    boundsMaximum = [...policy.boundsMaximum];
  }
  const center = boundsMinimum.map((value, axis) => (value + boundsMaximum[axis]!) / 2) as Vec3;
  const size = boundsMinimum.map((value, axis) => boundsMaximum[axis]! - value) as Vec3;
  if (size.some((extent) => extent <= 0 || extent > policy.maximumExtentMeters))
    throw new Error(
      `finite fog domain extent exceeds maximumExtentMeters=${policy.maximumExtentMeters}: ${size.join(', ')}`,
    );
  if (policy.edgeFalloffMeters >= Math.min(...size) / 2)
    throw new Error('finite fog edge falloff is not smaller than half the resolved minimum extent');
  const allSourcePointsContained = points.every((point) =>
    contains(boundsMinimum, boundsMaximum, point),
  );
  const allVisibleEntityBoundsContained = [...entityPoints.values()].every((positions) =>
    positions.every((point) => contains(boundsMinimum, boundsMaximum, point)),
  );
  const allCameraPositionsContained = cameraPositions.every((point) =>
    contains(boundsMinimum, boundsMaximum, point),
  );
  const allCameraTargetsContained = cameraTargets.every((point) =>
    contains(boundsMinimum, boundsMaximum, point),
  );
  if (
    !allSourcePointsContained ||
    !allVisibleEntityBoundsContained ||
    !allCameraPositionsContained ||
    !allCameraTargetsContained
  )
    throw new Error('finite fog domain does not contain every visible entity and camera keyframe');
  const includedVisibleEntityIds = visibleEntities.map((entity) => entity.id);
  const includedCameraKeyframeTimes = scene.camera.keyframes.map((keyframe) => keyframe.time);
  const derivation = {
    schemaVersion: 1,
    sceneId: scene.id,
    requestedPolicy: policy,
    sourcePointCount: points.length,
    sourceBoundsMinimum: sourceBounds.minimum,
    sourceBoundsMaximum: sourceBounds.maximum,
    boundsMinimum,
    boundsMaximum,
    includedVisibleEntityIds,
    includedCameraKeyframeTimes,
  };
  return {
    schemaVersion: 1,
    policy: policy.policy,
    coordinateSystem: 'videoer-y-up-meters',
    requestedPolicy: policy,
    sourcePointCount: points.length,
    sourceBoundsMinimum: sourceBounds.minimum,
    sourceBoundsMaximum: sourceBounds.maximum,
    includedVisibleEntityIds,
    includedCameraKeyframeTimes,
    containment: {
      allSourcePointsContained: true,
      allVisibleEntityBoundsContained: true,
      allCameraPositionsContained: true,
      allCameraTargetsContained: true,
    },
    boundsMinimum,
    boundsMaximum,
    center,
    size,
    maximumExtentMeters: policy.maximumExtentMeters,
    edgeFalloffMeters: policy.edgeFalloffMeters,
    derivationSha256: createHash('sha256').update(JSON.stringify(derivation)).digest('hex'),
  };
}
