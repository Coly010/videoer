import { deformSkinnedPositionsDualQuaternion } from '../geometry/kinematics.js';
import type { GeometryAsset, Vec3 } from '../geometry/model.js';
import {
  createQuinticMotionKeyframes,
  motionClipSchema,
  sampleMotionTrack,
  type MotionClip,
} from './model.js';
import type { MotionPose } from './composition.js';

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

function minimumSkinnedHeight(geometry: GeometryAsset, clip: MotionClip, seconds: number) {
  return Math.min(
    ...deformSkinnedPositionsDualQuaternion(geometry, samplePose(clip, seconds)).map(
      (position) => position[1],
    ),
  );
}

export interface CharacterGroundingOptions {
  floorHeight?: number;
  sampleCount?: number;
  verificationSampleCount?: number;
  maximumPenetrationMeters?: number;
  maximumClearanceMeters?: number;
  maximumCorrectionHarmonic?: number;
}

function bandlimitLoop(values: number[], maximumHarmonic: number) {
  const periodSamples = values.length - 1;
  const filtered = Array.from({ length: values.length }, (_, sampleIndex) => {
    const phase = (sampleIndex % periodSamples) / periodSamples;
    let reconstructed = 0;
    for (let harmonic = -maximumHarmonic; harmonic <= maximumHarmonic; harmonic++) {
      let real = 0;
      let imaginary = 0;
      for (let sourceIndex = 0; sourceIndex < periodSamples; sourceIndex++) {
        const angle = (-2 * Math.PI * harmonic * sourceIndex) / periodSamples;
        real += values[sourceIndex]! * Math.cos(angle);
        imaginary += values[sourceIndex]! * Math.sin(angle);
      }
      real /= periodSamples;
      imaginary /= periodSamples;
      const angle = 2 * Math.PI * harmonic * phase;
      reconstructed += real * Math.cos(angle) - imaginary * Math.sin(angle);
    }
    return reconstructed;
  });
  filtered[filtered.length - 1] = filtered[0]!;
  return filtered;
}

export function verifyCharacterGrounding(
  geometry: GeometryAsset,
  motionInput: MotionClip,
  options: CharacterGroundingOptions = {},
) {
  const motion = motionClipSchema.parse(motionInput);
  const floorHeight = options.floorHeight ?? 0;
  const sampleCount = options.verificationSampleCount ?? 241;
  const maximumPenetrationMeters = options.maximumPenetrationMeters ?? 0.005;
  const maximumClearanceMeters = options.maximumClearanceMeters ?? 0.01;
  const heights = Array.from({ length: sampleCount }, (_, index) => {
    const phase = index / (sampleCount - 1);
    return minimumSkinnedHeight(geometry, motion, phase * motion.durationSeconds);
  });
  const minimumHeight = Math.min(...heights);
  const maximumHeight = Math.max(...heights);
  const penetrationMeters = Math.max(0, floorHeight - minimumHeight);
  const clearanceMeters = Math.max(0, maximumHeight - floorHeight);
  const issues: string[] = [];
  if (penetrationMeters > maximumPenetrationMeters)
    issues.push(`skinned character penetrates the floor by ${penetrationMeters.toFixed(6)}m`);
  if (clearanceMeters > maximumClearanceMeters)
    issues.push(`skinned character floats ${clearanceMeters.toFixed(6)}m above the floor`);
  return {
    schemaVersion: 1 as const,
    status: issues.length ? ('fail' as const) : ('pass' as const),
    valid: issues.length === 0,
    issues,
    checks: {
      samples: sampleCount,
      floorHeight,
      minimumSkinnedHeight: minimumHeight,
      maximumSkinnedHeight: maximumHeight,
      penetrationMeters,
      clearanceMeters,
      maximumPenetrationMeters,
      maximumClearanceMeters,
    },
  };
}

/**
 * Re-solves root height against the final deformed production mesh. Grounding
 * therefore follows the target character's authored soles and skin weights,
 * not the proxy skeleton that happened to author the source motion.
 */
export function groundMotionToCharacter(
  geometry: GeometryAsset,
  motionInput: MotionClip,
  options: CharacterGroundingOptions = {},
) {
  const motion = motionClipSchema.parse(motionInput);
  const floorHeight = options.floorHeight ?? 0;
  const sampleCount = options.sampleCount ?? 241;
  if (sampleCount < 3) throw new Error('Character grounding requires at least three samples');
  const rootIndex = motion.tracks.findIndex(
    (track) => track.joint === 'root' && track.property === 'translation',
  );
  if (rootIndex < 0) throw new Error('Character grounding requires a root translation track');
  const root = motion.tracks[rootIndex]!;
  const samples = Array.from({ length: sampleCount }, (_, index) => {
    const seconds = (index / (sampleCount - 1)) * motion.durationSeconds;
    const value = sampleMotionTrack(root, seconds);
    const minimum = minimumSkinnedHeight(geometry, motion, seconds);
    return { value, correction: floorHeight - minimum };
  });
  const maximumCorrectionHarmonic = options.maximumCorrectionHarmonic ?? 12;
  const rawCorrections = samples.map((sample) => sample.correction);
  const filteredCorrections = motion.loop
    ? bandlimitLoop(rawCorrections, maximumCorrectionHarmonic)
    : rawCorrections;
  // Raise the filtered envelope by the largest removed peak. This preserves
  // ground exclusion while eliminating vertex-switch chatter from the exact
  // minimum-surface solve.
  const correctionEnvelope = motion.loop
    ? Math.max(
        0,
        ...rawCorrections.map((correction, index) => correction - filteredCorrections[index]!),
      ) + 0.00015
    : 0;
  const values = samples.map(
    ({ value }, index) =>
      [value[0], value[1] + filteredCorrections[index]! + correctionEnvelope, value[2]] as Vec3,
  );
  const tracks = motion.tracks.map((track, index) =>
    index === rootIndex
      ? {
          ...track,
          interpolation: 'quintic-hermite' as const,
          keyframes: createQuinticMotionKeyframes(values, motion.durationSeconds, motion.loop),
        }
      : structuredClone(track),
  );
  const grounded = motionClipSchema.parse({
    ...motion,
    tracks,
    metadata: {
      ...motion.metadata,
      characterGrounding: {
        generator: 'videoer.character-grounding.v1',
        geometry: geometry.id,
        floorHeight,
        samples: sampleCount,
        maximumCorrectionHarmonic: motion.loop ? maximumCorrectionHarmonic : null,
        correctionEnvelope,
        source: 'final-dual-quaternion-skinned-mesh',
      },
    },
  });
  const verification = verifyCharacterGrounding(geometry, grounded, options);
  if (!verification.valid)
    throw new Error(`Character grounding failed: ${verification.issues.join('; ')}`);
  return { motion: grounded, verification };
}
