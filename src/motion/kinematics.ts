import type { Vec3 } from '../geometry/model.js';
import { sampleMotionTrack, type MotionClip, type MotionTrack } from './model.js';

const magnitude = (value: Vec3) => Math.hypot(...value);
const subtract = (a: Vec3, b: Vec3): Vec3 => a.map((value, index) => value - b[index]!) as Vec3;
const scale = (value: Vec3, amount: number): Vec3 =>
  value.map((component) => component * amount) as Vec3;

function quantile(values: number[], fraction: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const amount = position - lower;
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * amount;
}

function derivatives(values: Vec3[], secondsPerSample: number) {
  const first = values
    .slice(1)
    .map((value, index) => scale(subtract(value, values[index]!), 1 / secondsPerSample));
  const second = first
    .slice(1)
    .map((value, index) => scale(subtract(value, first[index]!), 1 / secondsPerSample));
  const third = second
    .slice(1)
    .map((value, index) => scale(subtract(value, second[index]!), 1 / secondsPerSample));
  return { velocity: first, acceleration: second, jerk: third };
}

function vectorSpan(values: Vec3[]) {
  const minimum: Vec3 = [
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  ];
  const maximum: Vec3 = [
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ];
  for (const value of values)
    for (let axis = 0; axis < 3; axis++) {
      minimum[axis] = Math.min(minimum[axis]!, value[axis]!);
      maximum[axis] = Math.max(maximum[axis]!, value[axis]!);
    }
  return magnitude(subtract(maximum, minimum));
}

export interface MotionKinematicPolicy {
  sampleRateHz: number;
  minimumTranslationSpan: number;
  minimumRotationSpan: number;
  maximumNormalizedJerk: number;
  maximumJerkPeakToP95: number;
  maximumVelocitySeamRatio: number;
  maximumAccelerationSeamRatio: number;
}

export const naturalisticMotionKinematicPolicy: MotionKinematicPolicy = {
  sampleRateHz: 240,
  minimumTranslationSpan: 0.001,
  minimumRotationSpan: 0.005,
  maximumNormalizedJerk: 20_000,
  maximumJerkPeakToP95: 2.5,
  maximumVelocitySeamRatio: 0.1,
  maximumAccelerationSeamRatio: 0.1,
};

export interface MotionTrackKinematics {
  track: string;
  property: MotionTrack['property'];
  span: number;
  active: boolean;
  peakVelocity: number;
  peakAcceleration: number;
  peakJerk: number;
  peakJerkSeconds: number;
  peakJerkPhase: number;
  p95Jerk: number;
  normalizedPeakVelocity: number;
  normalizedPeakAcceleration: number;
  normalizedPeakJerk: number;
  jerkPeakToP95: number;
  velocitySeamRatio: number;
  accelerationSeamRatio: number;
}

function analyzeTrack(
  track: MotionTrack,
  clip: MotionClip,
  policy: MotionKinematicPolicy,
): MotionTrackKinematics {
  const intervals = Math.max(8, Math.ceil(clip.durationSeconds * policy.sampleRateHz));
  const secondsPerSample = clip.durationSeconds / intervals;
  const values = Array.from({ length: intervals + 1 }, (_, index) =>
    sampleMotionTrack(track, index * secondsPerSample),
  );
  const span = vectorSpan(values);
  const active =
    span >=
    (track.property === 'translation' ? policy.minimumTranslationSpan : policy.minimumRotationSpan);
  const { velocity, acceleration, jerk } = derivatives(values, secondsPerSample);
  const velocityMagnitudes = velocity.map(magnitude);
  const accelerationMagnitudes = acceleration.map(magnitude);
  const jerkMagnitudes = jerk.map(magnitude);
  const peakVelocity = Math.max(0, ...velocityMagnitudes);
  const peakAcceleration = Math.max(0, ...accelerationMagnitudes);
  const peakJerk = Math.max(0, ...jerkMagnitudes);
  const peakJerkIndex = jerkMagnitudes.indexOf(peakJerk);
  const p95Jerk = quantile(jerkMagnitudes, 0.95);
  const normalizationSpan = Math.max(
    span,
    track.property === 'translation' ? policy.minimumTranslationSpan : policy.minimumRotationSpan,
  );
  const firstKeyframe = track.keyframes[0]!;
  const lastKeyframe = track.keyframes.at(-1)!;
  const velocitySeam =
    track.interpolation === 'quintic-hermite'
      ? magnitude(subtract(lastKeyframe.velocity!, firstKeyframe.velocity!))
      : velocity.length > 1
        ? magnitude(subtract(velocity.at(-1)!, velocity[0]!))
        : 0;
  const accelerationSeam =
    track.interpolation === 'quintic-hermite'
      ? magnitude(subtract(lastKeyframe.acceleration!, firstKeyframe.acceleration!))
      : acceleration.length > 1
        ? magnitude(subtract(acceleration.at(-1)!, acceleration[0]!))
        : 0;
  return {
    track: `${track.joint}:${track.property}`,
    property: track.property,
    span,
    active,
    peakVelocity,
    peakAcceleration,
    peakJerk,
    peakJerkSeconds: (peakJerkIndex + 1.5) * secondsPerSample,
    peakJerkPhase: ((peakJerkIndex + 1.5) * secondsPerSample) / clip.durationSeconds,
    p95Jerk,
    normalizedPeakVelocity: (peakVelocity * clip.durationSeconds) / normalizationSpan,
    normalizedPeakAcceleration: (peakAcceleration * clip.durationSeconds ** 2) / normalizationSpan,
    normalizedPeakJerk: (peakJerk * clip.durationSeconds ** 3) / normalizationSpan,
    jerkPeakToP95: peakJerk / Math.max(p95Jerk, 1e-9),
    velocitySeamRatio: velocitySeam / Math.max(peakVelocity, 1e-9),
    accelerationSeamRatio: accelerationSeam / Math.max(peakAcceleration, 1e-9),
  };
}

export function analyzeMotionKinematics(
  clip: MotionClip,
  policy: MotionKinematicPolicy = naturalisticMotionKinematicPolicy,
) {
  const tracks = clip.tracks.map((track) => analyzeTrack(track, clip, policy));
  const active = tracks.filter((track) => track.active);
  return {
    schemaVersion: 1 as const,
    clip: clip.id,
    durationSeconds: clip.durationSeconds,
    policy,
    tracks,
    summary: {
      activeTracks: active.length,
      maximumNormalizedJerk: Math.max(0, ...active.map((track) => track.normalizedPeakJerk)),
      maximumJerkPeakToP95: Math.max(0, ...active.map((track) => track.jerkPeakToP95)),
      maximumVelocitySeamRatio: Math.max(0, ...active.map((track) => track.velocitySeamRatio)),
      maximumAccelerationSeamRatio: Math.max(
        0,
        ...active.map((track) => track.accelerationSeamRatio),
      ),
    },
  };
}

export function verifyMotionKinematics(
  clip: MotionClip,
  policy: MotionKinematicPolicy = naturalisticMotionKinematicPolicy,
) {
  const analysis = analyzeMotionKinematics(clip, policy);
  const failures = analysis.tracks.flatMap((track) => {
    if (!track.active) return [];
    const reasons: string[] = [];
    if (track.normalizedPeakJerk > policy.maximumNormalizedJerk)
      reasons.push(
        `normalized jerk ${track.normalizedPeakJerk.toFixed(1)} exceeds ${policy.maximumNormalizedJerk}`,
      );
    if (track.jerkPeakToP95 > policy.maximumJerkPeakToP95)
      reasons.push(
        `jerk impulse ratio ${track.jerkPeakToP95.toFixed(2)} exceeds ${policy.maximumJerkPeakToP95}`,
      );
    if (track.velocitySeamRatio > policy.maximumVelocitySeamRatio)
      reasons.push(
        `loop velocity seam ${track.velocitySeamRatio.toFixed(3)} exceeds ${policy.maximumVelocitySeamRatio}`,
      );
    if (track.accelerationSeamRatio > policy.maximumAccelerationSeamRatio)
      reasons.push(
        `loop acceleration seam ${track.accelerationSeamRatio.toFixed(3)} exceeds ${policy.maximumAccelerationSeamRatio}`,
      );
    return reasons.length ? [{ track: track.track, reasons }] : [];
  });
  return {
    valid: failures.length === 0,
    issues: failures.map((failure) => `${failure.track}: ${failure.reasons.join('; ')}`),
    failures,
    analysis,
  };
}
