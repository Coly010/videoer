import {
  deformSkinnedPositionsDualQuaternion,
  jointWorldTransforms,
} from '../geometry/kinematics.js';
import type { GeometryAsset, Vec3 } from '../geometry/model.js';
import type { MotionPose } from './composition.js';
import { identifySoleSurfaceRegions } from '../characters/sole-surface.js';
import {
  motionClipSchema,
  sampleMotionTrack,
  validateMotionClip,
  type MotionClip,
} from './model.js';

const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const horizontal = (value: Vec3): Vec3 => [value[0], 0, value[2]];
const magnitude = (value: Vec3) => Math.hypot(...value);
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function samplePose(motion: MotionClip, phase: number): MotionPose {
  const pose: MotionPose = {};
  const seconds = phase * motion.durationSeconds;
  for (const track of motion.tracks) {
    const joint = (pose[track.joint] ??= {});
    const value = sampleMotionTrack(track, seconds);
    if (track.property === 'rotation-euler') joint.rotation = value;
    else joint.translation = value;
  }
  return pose;
}

function percentile(values: number[], amount: number) {
  if (!values.length) return Number.NaN;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * amount))]!;
}

export interface CharacterMotionAlignmentOptions {
  minimumTravelMeters?: number;
  minimumFacingDot?: number;
}

/**
 * Proves that root travel agrees with the character mesh's own facial
 * direction. Production templates derive the gaze attachment from visible eye
 * geometry, rather than trusting only a nominal coordinate-system label.
 */
export function verifyCharacterMotionAlignment(
  geometry: GeometryAsset,
  motionInput: MotionClip,
  options: CharacterMotionAlignmentOptions = {},
) {
  const minimumTravelMeters = options.minimumTravelMeters ?? 0.1;
  const minimumFacingDot = options.minimumFacingDot ?? 0.8;
  const motion = motionClipSchema.parse(motionInput);
  const issues: string[] = [];
  const structural = validateMotionClip(motion, geometry);
  issues.push(...structural.issues.map((issue) => issue.message));
  const root = motion.tracks.find(
    (track) => track.joint === 'root' && track.property === 'translation',
  );
  const head = jointWorldTransforms(geometry).get('head');
  const gaze = geometry.attachments.gaze;
  if (!root) issues.push('motion has no root translation track');
  if (!head) issues.push("geometry has no 'head' joint");
  if (!gaze) issues.push("geometry has no 'gaze' attachment");
  if (gaze && gaze.bone !== 'head') issues.push("geometry 'gaze' attachment is not head-owned");

  const facingVector =
    head && gaze ? horizontal(subtract(gaze.position, head.position)) : ([0, 0, 0] as Vec3);
  const travelVector = root
    ? horizontal(
        subtract(sampleMotionTrack(root, motion.durationSeconds), sampleMotionTrack(root, 0)),
      )
    : ([0, 0, 0] as Vec3);
  const facingMagnitude = magnitude(facingVector);
  const travelMeters = magnitude(travelVector);
  if (facingMagnitude <= 1e-8)
    issues.push('head-to-gaze facing witness has no horizontal direction');
  if (travelMeters < minimumTravelMeters)
    issues.push(
      `root travel ${travelMeters.toFixed(4)}m is below ${minimumTravelMeters.toFixed(4)}m`,
    );
  const facingDot =
    facingMagnitude > 1e-8 && travelMeters > 1e-8
      ? dot(facingVector, travelVector) / facingMagnitude / travelMeters
      : 0;
  if (facingDot < minimumFacingDot)
    issues.push(
      `character travels against its facial direction (${facingDot.toFixed(6)} < ${minimumFacingDot.toFixed(6)})`,
    );
  return {
    schemaVersion: 1 as const,
    status: issues.length ? ('fail' as const) : ('pass' as const),
    valid: issues.length === 0,
    issues,
    checks: {
      facingWitness: 'head-to-gaze-attachment',
      facingVector,
      travelVector,
      travelMeters,
      facingDot,
      minimumTravelMeters,
      minimumFacingDot,
    },
  };
}

export interface CharacterFootRockerOptions {
  floorHeight?: number;
  maximumContactHeightMeters?: number;
  minimumHeelRiseMeters?: number;
  minimumInitialToeClearanceMeters?: number;
  minimumSwingClearanceMeters?: number;
}

/**
 * Verifies the heel-to-toe sequence on the final DQ-skinned sole surface.
 * This deliberately does not trust proxy ankle/toe endpoints: a retargeted or
 * grounded production mesh can satisfy those abstractions while its visible
 * heel floats or its rendered toes remain curled into swing.
 */
export function verifyCharacterFootRocker(
  geometry: GeometryAsset,
  motionInput: MotionClip,
  options: CharacterFootRockerOptions = {},
) {
  const motion = motionClipSchema.parse(motionInput);
  const floorHeight = options.floorHeight ?? 0;
  const maximumContactHeightMeters = options.maximumContactHeightMeters ?? 0.012;
  const minimumHeelRiseMeters = options.minimumHeelRiseMeters ?? 0.018;
  const minimumInitialToeClearanceMeters = options.minimumInitialToeClearanceMeters ?? 0.01;
  const minimumSwingClearanceMeters = options.minimumSwingClearanceMeters ?? 0.012;
  const restWorlds = jointWorldTransforms(geometry);
  const clusters = Object.fromEntries(
    (['left', 'right'] as const).map((side) => {
      const foot = restWorlds.get(`${side}-foot`);
      if (!foot) return [side, { heel: [] as number[], toe: [] as number[] }];
      const regions = identifySoleSurfaceRegions(geometry, side);
      return [
        side,
        {
          // Canonical forward is -Z: the heel is the rear/high-Z end and the
          // toe is the forward/low-Z end of the authored sole.
          heel: regions.heel.indices,
          toe: regions.forefoot.indices,
        },
      ];
    }),
  ) as Record<'left' | 'right', { heel: number[]; toe: number[] }>;
  const surfaceHeight = (side: 'left' | 'right', region: 'heel' | 'toe', localPhase: number) => {
    const globalPhase = side === 'right' ? localPhase : (localPhase + 0.5) % 1;
    const deformed = deformSkinnedPositionsDualQuaternion(
      geometry,
      samplePose(motion, globalPhase),
    );
    const values = clusters[side][region].map((index) => deformed[index]![1] - floorHeight);
    return percentile(values, 0.02);
  };
  const sides = Object.fromEntries(
    (['left', 'right'] as const).map((side) => [
      side,
      {
        clusterVertices: {
          heel: clusters[side].heel.length,
          toe: clusters[side].toe.length,
        },
        initialContact: {
          heelHeightMeters: surfaceHeight(side, 'heel', 0),
          toeHeightMeters: surfaceHeight(side, 'toe', 0),
        },
        midstance: {
          heelHeightMeters: surfaceHeight(side, 'heel', 0.2),
          toeHeightMeters: surfaceHeight(side, 'toe', 0.2),
        },
        terminalStance: {
          heelHeightMeters: surfaceHeight(side, 'heel', 0.52),
          toeHeightMeters: surfaceHeight(side, 'toe', 0.52),
        },
        midSwing: {
          heelHeightMeters: surfaceHeight(side, 'heel', 0.74),
          toeHeightMeters: surfaceHeight(side, 'toe', 0.74),
        },
      },
    ]),
  ) as Record<
    'left' | 'right',
    {
      clusterVertices: { heel: number; toe: number };
      initialContact: { heelHeightMeters: number; toeHeightMeters: number };
      midstance: { heelHeightMeters: number; toeHeightMeters: number };
      terminalStance: { heelHeightMeters: number; toeHeightMeters: number };
      midSwing: { heelHeightMeters: number; toeHeightMeters: number };
    }
  >;
  const issues: string[] = [];
  for (const [side, checks] of Object.entries(sides)) {
    if (!checks.clusterVertices.heel || !checks.clusterVertices.toe)
      issues.push(`${side} final-mesh sole regions could not be identified`);
    if (Math.abs(checks.initialContact.heelHeightMeters) > maximumContactHeightMeters)
      issues.push(
        `${side} heel is not grounded at initial contact (${checks.initialContact.heelHeightMeters.toFixed(6)}m)`,
      );
    if (checks.initialContact.toeHeightMeters < minimumInitialToeClearanceMeters)
      issues.push(`${side} toes lack clearance at initial heel contact`);
    if (
      Math.max(
        Math.abs(checks.midstance.heelHeightMeters),
        Math.abs(checks.midstance.toeHeightMeters),
      ) > maximumContactHeightMeters
    )
      issues.push(`${side} sole is not flat during midstance`);
    if (checks.terminalStance.heelHeightMeters < minimumHeelRiseMeters)
      issues.push(`${side} heel does not rise during terminal stance`);
    if (Math.abs(checks.terminalStance.toeHeightMeters) > maximumContactHeightMeters)
      issues.push(
        `${side} toe loses contact during terminal stance (${checks.terminalStance.toeHeightMeters.toFixed(6)}m)`,
      );
    if (
      Math.min(checks.midSwing.heelHeightMeters, checks.midSwing.toeHeightMeters) <
      minimumSwingClearanceMeters
    )
      issues.push(`${side} final-mesh foot lacks mid-swing clearance`);
  }
  return {
    schemaVersion: 1 as const,
    status: issues.length ? ('fail' as const) : ('pass' as const),
    valid: issues.length === 0,
    issues,
    checks: {
      surface: 'final-dual-quaternion-skinned-sole',
      samplePercentile: 0.02,
      phases: { initialContact: 0, midstance: 0.2, terminalStance: 0.52, midSwing: 0.74 },
      thresholds: {
        maximumContactHeightMeters,
        minimumHeelRiseMeters,
        minimumInitialToeClearanceMeters,
        minimumSwingClearanceMeters,
      },
      sides,
    },
  };
}
