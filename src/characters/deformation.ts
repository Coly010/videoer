import {
  deformSkinnedPositionsDualQuaternion,
  jointWorldTransforms,
} from '../geometry/kinematics.js';
import type { GeometryAsset, Vec3 } from '../geometry/model.js';
import { sampleMotionTrack, type MotionClip } from '../motion/model.js';
import type { MotionPose } from '../motion/composition.js';

const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const distance = (a: Vec3, b: Vec3) => Math.hypot(...subtract(a, b));
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const normalized = (value: Vec3): Vec3 => {
  const length = Math.hypot(...value);
  return length > 1e-12 ? [value[0] / length, value[1] / length, value[2] / length] : [0, 0, 0];
};

interface TriangleInfo {
  triangle: number;
  ids: readonly [number, number, number];
  rest: [Vec3, Vec3, Vec3];
  restUnitNormal: Vec3;
  restArea: number;
}

interface TriangleTopology {
  allTriangles: TriangleInfo[];
  edgeOwners: Map<string, number[]>;
}

function samplePose(clip: MotionClip, seconds: number): MotionPose {
  const pose: MotionPose = {};
  for (const track of clip.tracks) {
    const joint = (pose[track.joint] ??= {});
    const value = sampleMotionTrack(track, seconds);
    if (track.property === 'rotation-euler') joint.rotation = value;
    else joint.translation = value;
  }
  return pose;
}

function percentile(values: number[], amount: number) {
  if (!values.length) return Number.POSITIVE_INFINITY;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * amount))]!;
}

function triangleTopology(geometry: GeometryAsset): TriangleTopology {
  const allTriangles: TriangleInfo[] = [];
  const edgeOwners = new Map<string, number[]>();
  for (let index = 0; index < geometry.indices.length; index += 3) {
    const ids = [
      geometry.indices[index]!,
      geometry.indices[index + 1]!,
      geometry.indices[index + 2]!,
    ] as const;
    const rest = ids.map((id) => geometry.positions[id]!) as [Vec3, Vec3, Vec3];
    const restNormal = cross(subtract(rest[1], rest[0]), subtract(rest[2], rest[0]));
    const triangle = index / 3;
    allTriangles.push({
      triangle,
      ids,
      rest,
      restUnitNormal: normalized(restNormal),
      restArea: Math.hypot(...restNormal),
    });
    for (const [left, right] of [
      [ids[0], ids[1]],
      [ids[1], ids[2]],
      [ids[2], ids[0]],
    ] as const) {
      const edge = left < right ? `${left}:${right}` : `${right}:${left}`;
      const owners = edgeOwners.get(edge) ?? [];
      owners.push(triangle);
      edgeOwners.set(edge, owners);
    }
  }
  return { allTriangles, edgeOwners };
}

function regionMetrics(
  geometry: GeometryAsset,
  topology: TriangleTopology,
  centre: Vec3,
  radius: number,
  samples: Array<{ phase: number; deformed: Vec3[] }>,
) {
  const edgeLogStrains: number[] = [];
  const areaRatios: number[] = [];
  let flippedTriangles = 0;
  const flippedTriangleIndices = new Set<number>();
  const flipEvents: Array<{
    triangle: number;
    phase: number;
    normalizedOrientation: number;
    areaRatio: number;
  }> = [];
  const { allTriangles, edgeOwners } = topology;
  const regionTriangles = allTriangles
    .filter(({ rest }) => {
      const triangleCentre = rest.reduce(
        (sum, value) => [sum[0] + value[0] / 3, sum[1] + value[1] / 3, sum[2] + value[2] / 3],
        [0, 0, 0] as Vec3,
      );
      return distance(triangleCentre, centre) <= radius;
    })
    .map((triangle) => {
      const neighbours = new Set<number>();
      for (const [left, right] of [
        [triangle.ids[0], triangle.ids[1]],
        [triangle.ids[1], triangle.ids[2]],
        [triangle.ids[2], triangle.ids[0]],
      ] as const) {
        const edge = left < right ? `${left}:${right}` : `${right}:${left}`;
        for (const owner of edgeOwners.get(edge) ?? [])
          if (owner !== triangle.triangle) neighbours.add(owner);
      }
      return {
        ...triangle,
        neighbours: [...neighbours].filter(
          (neighbour) =>
            dot(triangle.restUnitNormal, allTriangles[neighbour]!.restUnitNormal) > 0.2,
        ),
      };
    });
  for (const { phase, deformed } of samples) {
    const posedNormals = allTriangles.map(({ ids }) =>
      normalized(
        cross(
          subtract(deformed[ids[1]]!, deformed[ids[0]]!),
          subtract(deformed[ids[2]]!, deformed[ids[0]]!),
        ),
      ),
    );
    for (const triangle of regionTriangles) {
      const { ids, rest, restArea } = triangle;
      const posed = ids.map((id) => deformed[id]!) as [Vec3, Vec3, Vec3];
      for (const [left, right] of [
        [0, 1],
        [1, 2],
        [2, 0],
      ] as const) {
        const restLength = distance(rest[left], rest[right]);
        const posedLength = distance(posed[left], posed[right]);
        if (restLength > 1e-9) edgeLogStrains.push(Math.abs(Math.log(posedLength / restLength)));
      }
      const posedNormal = cross(subtract(posed[1], posed[0]), subtract(posed[2], posed[0]));
      const posedArea = Math.hypot(...posedNormal);
      if (restArea > 1e-12) areaRatios.push(posedArea / restArea);
      const neighbourNormal = normalized(
        triangle.neighbours.reduce(
          (sum, neighbour) => [
            sum[0] + posedNormals[neighbour]![0],
            sum[1] + posedNormals[neighbour]![1],
            sum[2] + posedNormals[neighbour]![2],
          ],
          [0, 0, 0] as Vec3,
        ),
      );
      // Winding has no absolute world-space sign: a sound rigidly rotating
      // triangle can turn more than ninety degrees from bind pose. A real
      // surface inversion instead turns against its coherently oriented edge
      // neighbours, so grade orientation in the posed local surface frame.
      const normalizedOrientation = triangle.neighbours.length
        ? dot(normalized(posedNormal), neighbourNormal)
        : 1;
      if (normalizedOrientation < 0) {
        flippedTriangles++;
        flippedTriangleIndices.add(triangle.triangle);
        flipEvents.push({
          triangle: triangle.triangle,
          phase,
          normalizedOrientation,
          areaRatio: restArea > 1e-12 ? posedArea / restArea : 0,
        });
      }
    }
  }
  return {
    triangles: regionTriangles.length * samples.length,
    edgeLogStrainP99: percentile(edgeLogStrains, 0.99),
    areaRatioP01: percentile(areaRatios, 0.01),
    flippedTriangles,
    uniqueFlippedTriangles: flippedTriangleIndices.size,
    flipEvents,
  };
}

/** Walk-specific production deformation gate. It rejects the shoulder tear,
 * proxy-derived wrist counter-rotation, and foot/toe collapse that full-body
 * renders can hide. */
export function verifyWalkingExtremityDeformation(geometry: GeometryAsset, motion: MotionClip) {
  const worlds = jointWorldTransforms(geometry);
  const height = Number(
    (geometry.metadata.parameters as { height?: number } | undefined)?.height ?? 1.72,
  );
  // Sample the complete gait densely enough that a phase delay cannot move a
  // shoulder or toe inversion between a handful of canonical landmarks. The
  // earlier eight-point gate aliased delayed upper-body peaks and could report
  // a false pass for the same pose shape at a different time.
  const phases = Array.from({ length: 32 }, (_, index) => index / 32);
  const samples = phases.map((phase) => ({
    phase,
    deformed: deformSkinnedPositionsDualQuaternion(
      geometry,
      samplePose(motion, phase * motion.durationSeconds),
    ),
  }));
  const topology = triangleTopology(geometry);
  const regions = Object.fromEntries(
    (['left', 'right'] as const).flatMap((side) => [
      [
        `${side}Shoulder`,
        regionMetrics(
          geometry,
          topology,
          worlds.get(`${side}-upper-arm`)!.position,
          height * 0.14,
          samples,
        ),
      ],
      [
        `${side}Hand`,
        regionMetrics(
          geometry,
          topology,
          worlds.get(`${side}-hand`)!.position,
          height * 0.095,
          samples,
        ),
      ],
      [
        `${side}Foot`,
        regionMetrics(
          geometry,
          topology,
          worlds.get(`${side}-foot`)!.position,
          height * 0.13,
          samples,
        ),
      ],
      [
        `${side}Toe`,
        regionMetrics(
          geometry,
          topology,
          worlds.get(`${side}-toe`)!.position,
          height * 0.07,
          samples,
        ),
      ],
    ]),
  ) as Record<string, ReturnType<typeof regionMetrics>>;
  const unexpectedHandRotationTracks = motion.tracks
    .filter(
      (track) =>
        track.property === 'rotation-euler' &&
        (track.joint === 'left-hand' || track.joint === 'right-hand'),
    )
    .map((track) => track.joint);
  const issues: string[] = [];
  for (const [id, metrics] of Object.entries(regions)) {
    if (!metrics.triangles) issues.push(`${id} deformation region contains no triangles`);
    if (metrics.edgeLogStrainP99 > 0.3)
      issues.push(`${id} edge strain exceeds the walk deformation limit`);
    if (metrics.areaRatioP01 < 0.65) issues.push(`${id} contains collapsed surface area`);
    if (metrics.flippedTriangles)
      issues.push(`${id} contains ${metrics.flippedTriangles} flipped posed triangles`);
  }
  if (unexpectedHandRotationTracks.length)
    issues.push(
      `base walk contains unexpected hand rotation tracks: ${unexpectedHandRotationTracks.join(', ')}`,
    );
  return {
    schemaVersion: 1 as const,
    status: issues.length ? ('fail' as const) : ('pass' as const),
    valid: issues.length === 0,
    issues,
    checks: {
      phases,
      thresholds: { edgeLogStrainP99: 0.3, areaRatioP01: 0.65, flippedTriangles: 0 },
      unexpectedHandRotationTracks,
      regions,
    },
  };
}
